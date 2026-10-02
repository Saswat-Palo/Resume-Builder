"""
Streaming resume generation.

Two endpoints, both answering with Server-Sent Events so the browser can paint the resume
section by section while the model is still writing:

    POST /api/ai/build-stream    personal details + education + target role  ->  full draft
    POST /api/ai/refine-stream   current resume + the candidate's answers to the ATS
                                 follow-up questions                          ->  improved draft

The model is asked for JSON Lines (one complete JSON object per line). Every complete line is
validated and forwarded as soon as it arrives:

    data: {"type":"status","message":"..."}
    data: {"type":"section","section":"summary","value":"..."}
    data: {"type":"section","section":"experience","item":{...}}
    data: {"type":"done"}
    data: {"type":"error","message":"..."}
"""

import json
import re
from typing import Iterator, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .gemini_service import stream_text, get_client, extract_json
from .routes_ai import ExperienceItem, EducationItem, ProjectItem, ai_error

router = APIRouter(prefix="/api/ai", tags=["ai-build"])


# ---------------------------------------------------------------------------
# Request shapes
# ---------------------------------------------------------------------------

class BuildRequest(BaseModel):
    name: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    location: Optional[str] = ""
    linkedin: Optional[str] = ""
    website: Optional[str] = ""
    targetRole: Optional[str] = ""
    level: Optional[str] = ""
    skills: Optional[str] = ""
    background: Optional[str] = ""
    education: List[EducationItem] = []
    # What the user has already filled in by hand - the AI must keep and improve these, not replace them.
    summary: Optional[str] = ""
    certs: Optional[str] = ""
    langs: Optional[str] = ""
    experience: List[ExperienceItem] = []
    projects: List[ProjectItem] = []


class QA(BaseModel):
    id: Optional[str] = ""
    question: Optional[str] = ""
    answer: Optional[str] = ""


class RefineRequest(BaseModel):
    name: Optional[str] = ""
    title: Optional[str] = ""
    location: Optional[str] = ""
    level: Optional[str] = ""
    summary: Optional[str] = ""
    skills: Optional[str] = ""
    certs: Optional[str] = ""
    langs: Optional[str] = ""
    experience: List[ExperienceItem] = []
    education: List[EducationItem] = []
    projects: List[ProjectItem] = []
    answers: List[QA] = []
    jobDescription: Optional[str] = ""


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

LEVEL_LABELS = {
    "student": "student or fresher (no full-time experience yet)",
    "entry": "entry level (0-2 years)",
    "mid": "mid level (3-6 years)",
    "senior": "senior (7+ years)",
}

FORMAT_SPEC = """OUTPUT FORMAT - STRICT. Output JSON Lines: exactly one complete JSON object per line and nothing else (no markdown fences, no blank lines, no commentary). Emit the lines in this order and skip any that do not apply:
{"section":"summary","value":"<2-3 sentence professional summary, under 60 words>"}
{"section":"experience","item":{"company":"<company>","role":"<job title>","start":"<YYYY-MM or empty string>","end":"<YYYY-MM, Present, or empty string>","bullets":"<3-4 achievement bullets separated by \\n, no leading dashes>"}}
(one experience line per job or internship)
{"section":"projects","item":{"name":"<project name>","tech":"<tools used or empty string>","desc":"<1-2 sentence description>","link":""}}
(one projects line per project)
{"section":"skills","value":"<comma-separated skills>"}
{"section":"certs","value":"<one certification per line, separated by \\n>"}
{"section":"langs","value":"<comma-separated languages>"}
"""


def _edu_text(items: List[EducationItem]) -> str:
    lines = []
    for e in items:
        if not (e.degree or e.school):
            continue
        line = f"- {e.degree or 'Degree'}, {e.school or 'School'}"
        if e.year:
            line += f" ({e.year})"
        if e.gpa:
            line += f", GPA {e.gpa}"
        lines.append(line)
    return "\n".join(lines) or "(none)"


def _existing_exp_text(items: List[ExperienceItem]) -> str:
    out = []
    for e in items:
        if not (e.role or e.company):
            continue
        bullets = "\n".join(f"    - {b.strip()}" for b in (e.bullets or "").split("\n") if b.strip())
        out.append(f"- company: {e.company or ''} | role: {e.role or ''} | dates: {e.start or '?'} to {e.end or '?'}\n{bullets or '    (no bullets yet)'}")
    return "\n".join(out) or "(none)"


def _existing_proj_text(items: List[ProjectItem]) -> str:
    out = [
        f"- name: {p.name} | tech: {p.tech or ''} | description: {p.desc or '(none yet)'}"
        for p in items
        if p.name
    ]
    return "\n".join(out) or "(none)"


def _build_prompt(body: BuildRequest) -> str:
    level = LEVEL_LABELS.get((body.level or "").strip(), "not specified")
    return f"""You are an expert resume writer building a candidate's resume live, one section at a time.

{FORMAT_SPEC}
STRICT RULES:
- Ground every statement in the facts below. Never invent employers, job titles, project names, dates, grades or numbers.
- EXPERIENCE and PROJECTS come only from two sources: the candidate's EXISTING ENTRIES and their BACKGROUND NOTES. If both are empty, emit NO experience lines and NO projects lines.
- MERGE, DO NOT REPLACE: emit one experience line for EVERY existing entry (polished) and one projects line for EVERY existing project. Copy company, role, start and end (and project name) EXACTLY as given. Keep every fact and existing bullet - only make wording stronger, and add bullets only when the candidate's own text supports them. If an existing entry has no bullets, write 2-3 grounded bullets that describe the scope of that role without inventing numbers or tools.
- Then add any further job, internship or project described in the BACKGROUND NOTES that is not already in the existing entries. Never output the same job or project twice.
- If the candidate already wrote a summary, refine it using the rest of the facts instead of discarding its content.
- Bullets: start each with a strong past-tense action verb, under 22 words, no trailing period. Use a number only if the candidate gave one; otherwise describe scope and impact qualitatively.
- SUMMARY: 2-3 sentences, under 60 words, no first-person pronouns, no cliches such as "results-driven", "team player" or "hard worker". Tailor it to the target role. For students and freshers lead with the education and the skills being built; never claim years of experience.
- SKILLS: begin with every skill the candidate listed or clearly used in their notes, then add core skills this target role typically requires (tools, technologies, methods) so the list has 8 to 14 items. No soft-skill filler, no duplicates.
- Do not output contact details or education - they are already on the resume.

CANDIDATE
Name: {body.name or 'N/A'}
Target role: {body.targetRole or 'N/A'}
Experience level: {level}
Location: {body.location or 'N/A'}
Education:
{_edu_text(body.education)}
Skills they already have: {(body.skills or '').strip() or '(none listed)'}
Summary they already wrote: {(body.summary or '').strip() or '(none)'}
Certifications they already listed: {(body.certs or '').replace(chr(10), '; ').strip() or '(none)'}
Languages they already listed: {(body.langs or '').strip() or '(none)'}
EXISTING EXPERIENCE ENTRIES:
{_existing_exp_text(body.experience)}
EXISTING PROJECTS:
{_existing_proj_text(body.projects)}
BACKGROUND NOTES (may be empty):
<<<
{(body.background or '').strip() or '(empty)'}
>>>"""


def _resume_snapshot(body: RefineRequest) -> str:
    exp = []
    for e in body.experience:
        if not (e.role or e.company):
            continue
        bullets = "\n".join(f"    - {b.strip()}" for b in (e.bullets or "").split("\n") if b.strip())
        exp.append(
            f"- company: {e.company or ''} | role: {e.role or ''} | {e.start or '?'} to {e.end or '?'}\n{bullets}"
        )
    proj = [
        f"- name: {p.name} | tech: {p.tech or ''} | desc: {p.desc or ''}"
        for p in body.projects
        if p.name
    ]
    return f"""Name: {body.name or 'N/A'}
Target role: {body.title or 'N/A'}
Location: {body.location or 'N/A'}
Summary: {body.summary or '(none)'}
Skills: {body.skills or '(none)'}
Experience:
{chr(10).join(exp) or '(none)'}
Projects:
{chr(10).join(proj) or '(none)'}
Education:
{_edu_text(body.education)}
Certifications: {(body.certs or '').replace(chr(10), '; ') or '(none)'}
Languages: {body.langs or '(none)'}"""


def _refine_prompt(body: RefineRequest) -> str:
    qa = "\n".join(
        f"Q: {a.question}\nA: {(a.answer or '').strip()}"
        for a in body.answers
        if (a.answer or "").strip()
    )
    jd = (body.jobDescription or "").strip()
    jd_block = f"\nTARGET JOB DESCRIPTION (use its wording only where it is truthful for this candidate):\n<<<\n{jd}\n>>>\n" if jd else ""
    level = LEVEL_LABELS.get((body.level or "").strip(), "not specified")

    return f"""You are an expert resume writer improving an existing resume after an ATS review. The candidate has just answered follow-up questions with new facts. Fold those facts into the resume.

{FORMAT_SPEC}
WHAT TO EMIT:
- "summary": always, rewritten so it reflects the new information.
- "experience": EVERY job or internship - existing ones (improved wording, plus any new facts from the answers) and any new ones the answers describe. Copy company and role EXACTLY as they appear in the current resume for existing entries.
- "projects": every project - existing plus new ones from the answers. Copy the project name exactly for existing ones.
- "skills": the complete merged list (existing skills plus tools the answers mention).
- "certs" / "langs": only if the resume or the answers contain some; emit the complete list.

STRICT RULES:
- Use ONLY facts in the current resume or the candidate's answers. Never invent employers, dates, numbers, tools or achievements.
- Keep every existing bullet unless you are making it stronger; add bullets only when the answers support them.
- Bullets start with a strong past-tense action verb, under 22 words, no trailing period. Use numbers only if the candidate supplied them.
- Summary: 2-3 sentences, under 60 words, no first-person pronouns, no cliches.
- Do not output contact details or education.

CANDIDATE LEVEL: {level}

CURRENT RESUME
{_resume_snapshot(body)}

CANDIDATE'S NEW DETAILS
{qa}
{jd_block}"""


# ---------------------------------------------------------------------------
# JSON-lines -> validated events
# ---------------------------------------------------------------------------

ALLOWED_SECTIONS = {"summary", "experience", "projects", "skills", "certs", "langs"}
LIST_SECTIONS = {"experience", "projects"}
ITEM_FIELDS = {
    "experience": ("company", "role", "start", "end", "bullets"),
    "projects": ("name", "tech", "desc", "link"),
}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(str(v).strip() for v in value if str(v).strip())
    return str(value).strip()


def _parse_line(line: str) -> Optional[dict]:
    line = line.strip()
    line = re.sub(r"^```[a-zA-Z]*", "", line).strip()
    if line.endswith("```"):
        line = line[:-3].strip()
    if not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        try:
            obj = json.loads(re.sub(r",(\s*[}\]])", r"\1", line))
        except json.JSONDecodeError:
            return None
    return obj if isinstance(obj, dict) else None


def _clean_item(section: str, item: dict) -> Optional[dict]:
    out = {}
    for field in ITEM_FIELDS[section]:
        out[field] = _text(item.get(field))
    if section == "experience":
        out["bullets"] = "\n".join(
            re.sub(r"^[\-\u2022*]+\s*", "", b).strip() for b in out["bullets"].split("\n") if b.strip()
        )
        if not (out["company"] or out["role"]):
            return None
    elif not out["name"]:
        return None
    return out


def _to_event(obj: dict) -> Optional[dict]:
    section = str(obj.get("section", "")).strip().lower()
    if section not in ALLOWED_SECTIONS:
        return None
    if section in LIST_SECTIONS:
        item = obj.get("item")
        cleaned = _clean_item(section, item) if isinstance(item, dict) else None
        return {"section": section, "item": cleaned} if cleaned else None

    value = obj.get("value")
    if isinstance(value, list):
        sep = "\n" if section == "certs" else ", "
        value = sep.join(str(v).strip() for v in value if str(v).strip())
    value = _text(value)
    return {"section": section, "value": value} if value else None


def _fallback_events(full_text: str) -> Iterator[dict]:
    """The model ignored the JSON-lines format and returned one object (autofill-shaped)."""
    try:
        data = extract_json(full_text)
    except Exception:
        return
    if not isinstance(data, dict):
        return
    for key in ("summary", "experience", "projects", "skills", "certs", "langs"):
        val = data.get(key)
        if key in LIST_SECTIONS:
            for item in val or []:
                evt = _to_event({"section": key, "item": item}) if isinstance(item, dict) else None
                if evt:
                    yield evt
        else:
            evt = _to_event({"section": key, "value": val})
            if evt:
                yield evt


def _stream_response(prompt: str, max_tokens: int, status_message: str) -> StreamingResponse:
    def gen():
        emitted = 0
        pieces: List[str] = []
        buf = ""
        try:
            yield _sse({"type": "status", "message": status_message})
            for chunk in stream_text(prompt, max_output_tokens=max_tokens, temperature=0.5):
                pieces.append(chunk)
                buf += chunk
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    obj = _parse_line(line)
                    evt = _to_event(obj) if obj else None
                    if evt:
                        emitted += 1
                        yield _sse({"type": "section", **evt})
            if buf.strip():
                obj = _parse_line(buf)
                evt = _to_event(obj) if obj else None
                if evt:
                    emitted += 1
                    yield _sse({"type": "section", **evt})
            if emitted == 0:
                for evt in _fallback_events("".join(pieces)):
                    emitted += 1
                    yield _sse({"type": "section", **evt})
            if emitted == 0:
                raise ValueError("The AI didn't return any resume content. Please try again.")
            yield _sse({"type": "done"})
        except Exception as err:  # surfaced to the browser as an error event
            yield _sse({"type": "error", "message": str(err) or "AI request failed."})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/build-stream")
def ai_build_stream(body: BuildRequest):
    if not (body.name or "").strip():
        raise HTTPException(status_code=400, detail="Add your full name first.")
    if not (body.targetRole or "").strip():
        raise HTTPException(status_code=400, detail="Add the role you are targeting so the AI knows what to write for.")
    if not any((e.degree or e.school) for e in body.education):
        raise HTTPException(status_code=400, detail="Add at least one education entry (degree or institution).")

    try:
        get_client()  # fail fast with a normal JSON error if the API key is missing
    except Exception as err:
        raise ai_error(err)

    return _stream_response(_build_prompt(body), 6000, "Writing your resume...")


@router.post("/refine-stream")
def ai_refine_stream(body: RefineRequest):
    if not any(len((a.answer or "").strip()) >= 3 for a in body.answers):
        raise HTTPException(status_code=400, detail="Answer at least one of the questions so the AI has something new to add.")

    try:
        get_client()
    except Exception as err:
        raise ai_error(err)

    return _stream_response(_refine_prompt(body), 7000, "Updating your resume...")
