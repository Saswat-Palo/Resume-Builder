"""
Thin wrapper around the Gemini API (google-genai SDK). Kept deliberately small:
one client, one text-generation helper, one JSON-extraction helper. Every
AI route in routes_ai.py builds its own prompt and calls generate_text().
"""

import os
import re
import json
import time

from google import genai
from google.genai import types
from google.genai import errors as genai_errors

_client: genai.Client | None = None


class MissingApiKeyError(Exception):
    """Raised when GEMINI_API_KEY isn't configured — caught in routes_ai.py as a 500 with a clear message."""


def get_client() -> genai.Client:
    global _client
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise MissingApiKeyError(
            "GEMINI_API_KEY is not set on the server. Add it to your .env file and restart the server."
        )
    if _client is None:
        _client = genai.Client(api_key=api_key)
    return _client


# "gemini-3.8-flash" (the previous default here) was never a real Gemini model — that's
# what produced the 503 UNAVAILABLE error. As of Sept 2026 the current stable flash model
# is gemini-2.5-flash (GA, scheduled for shutdown 16 Oct 2026) with gemini-3.5-flash as its
# GA successor. Override with GEMINI_MODEL in .env if needed — check
# https://ai.google.dev/gemini-api/docs/models for whatever's current when you read this.
AI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")

# Tried in order if the configured model 404s (retired/renamed) or 503s (overloaded) after
# retries. Keeps the app working through Google's model churn without a code change.
MODEL_FALLBACKS = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite"]


def extract_json(text: str):
    """Gemini sometimes wraps JSON in markdown fences or adds a stray sentence before/after
    the object despite instructions, and occasionally leaves a trailing comma. Try increasingly
    forgiving strategies before giving up."""
    cleaned = re.sub(r"```json\s*|```\s*", "", text).strip()

    # Isolate the outermost {...} or [...] in case the model added leading/trailing prose.
    match = re.search(r"[\{\[].*[\}\]]", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(0)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Common model slip: a trailing comma before a closing brace/bracket.
    repaired = re.sub(r",(\s*[\}\]])", r"\1", cleaned)
    return json.loads(repaired)


def _is_retryable(err: Exception) -> bool:
    """503 UNAVAILABLE (overloaded) is transient — worth a short backoff-and-retry."""
    code = getattr(err, "code", None)
    status = (getattr(err, "status", None) or "").upper()
    return code == 503 or status == "UNAVAILABLE"


def _is_model_missing(err: Exception) -> bool:
    """404 NOT_FOUND means the model name doesn't exist/was retired — no point retrying it."""
    code = getattr(err, "code", None)
    status = (getattr(err, "status", None) or "").upper()
    return code == 404 or status == "NOT_FOUND"


def _finish_reason(response) -> str | None:
    try:
        candidates = response.candidates or []
        if not candidates:
            return None
        reason = candidates[0].finish_reason
        return getattr(reason, "value", reason)
    except Exception:
        return None


def generate_text(prompt: str, max_output_tokens: int = 500, temperature: float = 0.7) -> str:
    client = get_client()

    models_to_try = [AI_MODEL] + [m for m in MODEL_FALLBACKS if m != AI_MODEL]
    last_err: Exception | None = None

    for model in models_to_try:
        attempts = 3 if model == AI_MODEL else 1
        # If the response gets cut off mid-JSON (MAX_TOKENS), one retry with more headroom
        # usually fixes it — this is the most common cause of "AI response couldn't be parsed".
        budget = max_output_tokens
        for attempt in range(attempts):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=temperature,
                        max_output_tokens=budget,
                    ),
                )
                text = (response.text or "").strip()
                reason = _finish_reason(response)
                if reason == "MAX_TOKENS" and budget < 8000:
                    last_err = ValueError(
                        "The AI response was cut off before it finished. Retrying with more room…"
                    )
                    budget = min(budget * 2, 8000)
                    continue  # same model, bigger budget, doesn't count against the 503-retry attempts
                if not text:
                    raise ValueError("The AI returned an empty response. Please try again.")
                return text
            except (genai_errors.APIError, ValueError) as err:
                last_err = err
                if isinstance(err, genai_errors.APIError) and (_is_retryable(err) or _is_model_missing(err)):
                    if _is_retryable(err) and attempt < attempts - 1:
                        time.sleep(1.5 * (attempt + 1))  # brief backoff, then retry same model
                        continue
                    break  # move on to the next fallback model
                if isinstance(err, ValueError) and attempt < attempts - 1:
                    continue  # empty-response retry
                raise  # non-retryable error (bad request, auth, etc.) — surface it immediately

    # Every model in the list failed — raise the most recent, informative error.
    if isinstance(last_err, genai_errors.APIError):
        raise RuntimeError(
            f"The AI service is temporarily unavailable ({last_err.status or last_err.code}). "
            "Please try again in a moment."
        ) from last_err
    raise last_err or RuntimeError("AI request failed for an unknown reason.")


def stream_text(prompt: str, max_output_tokens: int = 4000, temperature: float = 0.6):
    """Yield the model's answer as it is generated (text chunks).

    Same model-fallback and 503-retry behaviour as generate_text(), but because chunks are
    already on their way to the browser by the time an error can happen, fallback/retry only
    applies *before* the first chunk arrives. An error after that point is re-raised so the
    caller can tell the user the stream stopped early.
    """
    client = get_client()

    models_to_try = [AI_MODEL] + [m for m in MODEL_FALLBACKS if m != AI_MODEL]
    last_err: Exception | None = None

    for model in models_to_try:
        attempts = 3 if model == AI_MODEL else 1
        for attempt in range(attempts):
            started = False
            try:
                stream = client.models.generate_content_stream(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=temperature,
                        max_output_tokens=max_output_tokens,
                    ),
                )
                for chunk in stream:
                    try:
                        piece = chunk.text or ""
                    except (AttributeError, ValueError):
                        piece = ""
                    if piece:
                        started = True
                        yield piece
                if started:
                    return
                raise ValueError("The AI returned an empty response. Please try again.")
            except (genai_errors.APIError, ValueError) as err:
                if started:
                    raise
                last_err = err
                if isinstance(err, genai_errors.APIError) and (_is_retryable(err) or _is_model_missing(err)):
                    if _is_retryable(err) and attempt < attempts - 1:
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    break
                if isinstance(err, ValueError) and attempt < attempts - 1:
                    continue
                raise

    if isinstance(last_err, genai_errors.APIError):
        raise RuntimeError(
            f"The AI service is temporarily unavailable ({last_err.status or last_err.code}). "
            "Please try again in a moment."
        ) from last_err
    raise last_err or RuntimeError("AI request failed for an unknown reason.")
