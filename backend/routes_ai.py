import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

if __package__:
    from .gemini_service import generate_text, extract_json, MissingApiKeyError
else:
    from gemini_service import generate_text, extract_json, MissingApiKeyError

router = APIRouter(prefix="/api/ai", tags=["ai"])


def ai_error(err: Exception) -> HTTPException:
    if isinstance(err, MissingApiKeyError):
        return HTTPException(status_code=500, detail=str(err))
    return HTTPException(status_code=500, detail=str(err) or "AI request failed.")


# ---------------------------------------------------------------------------
# Shared shapes
# ---------------------------------------------------------------------------

class ExperienceItem(BaseModel):
    id: Optional[int] = None
    company: Optional[str] = ""
    role: Optional[str] = ""
    start: Optional[str] = ""
    end: Optional[str] = ""
    bullets: Optional[str] = ""


class EducationItem(BaseModel):
    id: Optional[int] = None
    degree: Optional[str] = ""
    school: Optional[str] = ""
    year: Optional[str] = ""
    gpa: Optional[str] = ""


class ProjectItem(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = ""
    tech: Optional[str] = ""
    desc: Optional[str] = ""
    link: Optional[str] = ""


# ---------------------------------------------------------------------------
# 1. Professional summary writer
# ---------------------------------------------------------------------------

class SummaryRequest(BaseModel):
    name: Optional[str] = ""
    title: Optional[str] = ""
    location: Optional[str] = ""
    skills: Optional[str] = ""
    experience: List[ExperienceItem] = []


@router.post("/summary")
def ai_summary(body: SummaryRequest):
    has_exp = any(e.role or e.company for e in body.experience)
    if not body.title and not body.skills and not has_exp:
        raise HTTPException(
            status_code=400,
            detail="Add a target job title, a few skills, or at least one work entry first — the AI needs something to summarize.",
        )

    exp_lines = []
    for e in body.experience[:5]:
        if not (e.role or e.company):
            continue
        bullet_preview = "; ".join([b.strip() for b in (e.bullets or "").split("\n") if b.strip()][:2])
        line = f"- {e.role or 'Role'} at {e.company or 'Company'}"
        if bullet_preview:
            line += f" ({bullet_preview})"
        exp_lines.append(line)

    prompt = f"""Write a professional resume summary for the candidate below. Rules:
- 2 to 3 sentences, under 60 words total.
- Confident and specific, grounded only in the facts given — never invent employers, numbers, or skills not listed.
- No first-person pronouns, no clichés like "results-driven team player" or "hard worker".
- Return ONLY the summary text. No preamble, no quotation marks, no markdown.

Name: {body.name or 'N/A'}
Target role: {body.title or 'N/A'}
Location: {body.location or 'N/A'}
Skills: {body.skills or 'N/A'}
Recent experience:
{chr(10).join(exp_lines) or 'N/A'}"""

    try:
        summary = generate_text(prompt, max_output_tokens=300)
        return {"summary": summary}
    except Exception as err:
        raise ai_error(err)


# ---------------------------------------------------------------------------
# 2. Role / achievement bullet writer (per experience entry)
# ---------------------------------------------------------------------------

class RoleObjectiveRequest(BaseModel):
    company: Optional[str] = ""
    role: Optional[str] = ""
    start: Optional[str] = ""
    end: Optional[str] = ""
    existingBullets: Optional[str] = ""
    targetTitle: Optional[str] = ""


@router.post("/role-objective")
def ai_role_objective(body: RoleObjectiveRequest):
    if not body.company and not body.role:
        raise HTTPException(status_code=400, detail="Add a company or role title first so the AI knows what to write about.")

    prompt = f"""You are helping write resume bullet points for one work-experience entry. Given the role details, produce 3 to 4 strong achievement-style bullet points.

Rules:
- Start each bullet with a strong past-tense action verb (Led, Built, Reduced, Launched, etc.) — never "Responsible for".
- Prefer measurable outcomes (%, time saved, scale, revenue) but if none are given, describe scope and impact plausibly for this role WITHOUT inventing specific fabricated numbers — use qualitative impact instead (e.g. "streamlined", "improved reliability of").
- Keep each bullet under 20 words, no periods at the end.
- If the candidate already listed some bullets/notes, refine and expand on them rather than ignoring them.
- Tailor tone toward the candidate's target role if given.
- Return ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{{"bullets": ["bullet one", "bullet two", "bullet three"]}}

Company: {body.company or 'N/A'}
Role/title held: {body.role or 'N/A'}
Dates: {body.start or 'N/A'} to {body.end or 'N/A'}
Candidate's target job title (for tone): {body.targetTitle or 'N/A'}
Existing notes from candidate: {body.existingBullets or 'None provided'}"""

    try:
        raw = generate_text(prompt, max_output_tokens=700)
        try:
            bullets = extract_json(raw).get("bullets")
        except Exception:
            bullets = [
                line.strip("-*. \t")
                for line in raw.split("\n")
                if line.strip()
            ]

        if not bullets:
            raise ValueError("The AI didn't return any bullet points. Try again.")

        return {"bullets": bullets}
    except Exception as err:
        raise ai_error(err)


# ---------------------------------------------------------------------------
# 3. ATS score checker
# ---------------------------------------------------------------------------

class ATSRequest(BaseModel):
    name: Optional[str] = ""
    title: Optional[str] = ""
    location: Optional[str] = ""
    summary: Optional[str] = ""
    skills: Optional[str] = ""
    certs: Optional[str] = ""
    experience: List[ExperienceItem] = []
    education: List[EducationItem] = []
    jobDescription: Optional[str] = ""
    # Optional extras (older clients simply omit them)
    email: Optional[str] = ""
    phone: Optional[str] = ""
    linkedin: Optional[str] = ""
    website: Optional[str] = ""
    langs: Optional[str] = ""
    projects: List[ProjectItem] = []


def _build_resume_text(body: ATSRequest) -> str:
    exp_text = "\n\n".join(
        f"{e.role or 'Role'} at {e.company or 'Company'} ({e.start or '?'} - {e.end or '?'})\n"
        + "\n".join(f"  - {b.strip()}" for b in (e.bullets or "").split("\n") if b.strip())
        for e in body.experience
    )
    edu_text = "\n".join(f"{e.degree or 'Degree'}, {e.school or 'School'} ({e.year or '?'})" for e in body.education)

    contact_bits = [x for x in [body.email, body.phone, body.linkedin, body.website] if x]
    proj_text = "\n".join(
        f"- {p.name}" + (f" ({p.tech})" if p.tech else "") + (f": {p.desc}" if p.desc else "")
        for p in body.projects
        if p.name
    )

    return f"""Name: {body.name or 'N/A'}
Target title: {body.title or 'N/A'}
Location: {body.location or 'N/A'}
Contact details present: {', '.join(contact_bits) if contact_bits else '(none listed)'}

Summary:
{body.summary or '(none written)'}

Skills:
{body.skills or '(none listed)'}

Experience:
{exp_text or '(none listed)'}

Projects:
{proj_text or '(none listed)'}

Education:
{edu_text or '(none listed)'}

Certifications:
{body.certs or '(none listed)'}

Languages:
{body.langs or '(none listed)'}"""


# Questions the ATS checker can ask when the resume lacks facts only the candidate knows.
_GAP_LIBRARY = {
    "experience": {
        "question": "Do you have any internships, part-time jobs, freelance or volunteer work? List the organisation, your role, the dates and what you did.",
        "hint": "e.g. Data intern at Acme Ltd, Jun-Aug 2025 - cleaned sales data and built weekly dashboards",
    },
    "projects": {
        "question": "Which projects (academic, personal or open-source) are you proudest of? Give the name, the tools you used and what it did.",
        "hint": "e.g. Expense tracker web app - built with React and Firebase, used by 30 classmates",
    },
    "achievements": {
        "question": "Can you add real numbers to your achievements - users, % improvement, time or money saved, team size, scale?",
        "hint": "e.g. Cut report preparation from 2 days to 3 hours; supported a team of 6",
    },
    "skills": {
        "question": "Which tools, technologies or methods have you actually used? List as many as you are comfortable discussing in an interview.",
        "hint": "e.g. Python, SQL, Excel, Power BI, Git, A/B testing",
    },
    "certs": {
        "question": "Do you have any certifications, courses or awards worth listing?",
        "hint": "e.g. Google Data Analytics Certificate, 2025",
    },
    "summary": {
        "question": "In a sentence or two, what kind of work are you aiming for and what makes you a good fit?",
        "hint": "e.g. I want to move into product analytics; I enjoy turning messy data into decisions",
    },
}


def _norm_gap_id(raw: str) -> str:
    r = (raw or "").lower()
    if "exper" in r or "intern" in r or "work" in r:
        return "experience"
    if "project" in r:
        return "projects"
    if "metric" in r or "achiev" in r or "quant" in r or "impact" in r:
        return "achievements"
    if "skill" in r or "keyword" in r or "tool" in r:
        return "skills"
    if "cert" in r or "course" in r or "award" in r:
        return "certs"
    if "summ" in r or "goal" in r or "objective" in r:
        return "summary"
    return r or "other"


def _heuristic_gaps(body: "ATSRequest") -> List[str]:
    """Deterministic checks so the follow-up questions never depend on the model alone."""
    exp = [e for e in body.experience if (e.role or e.company)]
    projs = [p for p in body.projects if p.name]
    skills = [s for s in (body.skills or "").split(",") if s.strip()]
    bullets = [b for e in exp for b in (e.bullets or "").split("\n") if b.strip()]

    gaps: List[str] = []
    if not exp:
        gaps.append("experience")
    if not projs and len(exp) < 2:
        gaps.append("projects")
    if exp and (len(bullets) < 2 * len(exp) or not any(re.search(r"\d", b) for b in bullets)):
        gaps.append("achievements")
    if len(skills) < 6:
        gaps.append("skills")
    if not (body.certs or "").strip() and len(gaps) < 2:
        gaps.append("certs")
    return gaps


@router.post("/ats-check")
def ai_ats_check(body: ATSRequest):
    has_content = body.title or body.summary or body.skills or len(body.experience) > 0
    if not has_content:
        raise HTTPException(status_code=400, detail="Fill in at least a title, summary, skills, or one work entry before running the ATS check.")

    resume_text = _build_resume_text(body)
    jd = (body.jobDescription or "").strip()

    context_line = (
        " against the target job description"
        if jd
        else " using general ATS best practices (keyword clarity, structure, quantified impact, standard section naming, no graphics/tables reliance)"
    )

    prompt = f"""You are an ATS (Applicant Tracking System) resume auditor. Evaluate the resume below{context_line}.

Return ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{{
  "score": <integer 0-100>,
  "verdict": "<one short phrase, e.g. 'Strong match' or 'Needs work'>",
  "strengths": ["<short strength 1>", "<short strength 2>", ...],
  "improvements": ["<specific, actionable suggestion 1>", "<specific, actionable suggestion 2>", ...],
  "missingKeywords": ["<keyword or phrase from the job description not found in the resume>", ...],
  "needsMoreInfo": [{{"id": "<experience|projects|achievements|skills|certs|summary>", "question": "<direct question to the candidate>", "hint": "<short example answer>"}}]
}}

Rules:
- 2 to 4 items in strengths, 3 to 6 items in improvements.
- missingKeywords must be an empty array if no job description was provided.
- Improvements must be concrete and actionable (e.g. "Add a metric to the Acme Corp bullet about redesigning checkout" not "add more detail").
- Be honest — do not inflate the score just to be encouraging.
- needsMoreInfo: 0 to 4 items. Include an item ONLY when the resume lacks facts that cannot be inferred and the candidate must supply them (no experience or projects listed, achievements without numbers, fewer than 6 skills, and so on). Each question is plain, direct and second-person. Use an empty array when the resume is already strong (score 85 or above).

RESUME:
{resume_text}

{f"TARGET JOB DESCRIPTION:{chr(10)}{jd}" if jd else ""}"""

    try:
        raw = generate_text(prompt, max_output_tokens=1500)
        try:
            result = extract_json(raw)
        except Exception:
            raise ValueError("The AI response couldn't be parsed. Please try again.")

        result["score"] = max(0, min(100, int(result.get("score") or 0)))
        result["strengths"] = result.get("strengths") or []
        result["improvements"] = result.get("improvements") or []
        result["missingKeywords"] = result.get("missingKeywords") or []

        needs: List[dict] = []
        seen = set()
        for item in result.get("needsMoreInfo") or []:
            if not isinstance(item, dict) or not str(item.get("question") or "").strip():
                continue
            gid = _norm_gap_id(str(item.get("id") or ""))
            if gid in seen:
                continue
            seen.add(gid)
            needs.append({
                "id": gid,
                "question": str(item["question"]).strip(),
                "hint": str(item.get("hint") or "").strip(),
            })
        if result["score"] < 90:
            for gid in _heuristic_gaps(body):
                if gid not in seen and len(needs) < 4:
                    seen.add(gid)
                    needs.append({"id": gid, **_GAP_LIBRARY[gid]})
        result["needsMoreInfo"] = needs[:4]
        return result
    except Exception as err:
        raise ai_error(err)


# ---------------------------------------------------------------------------
# 4. Full-resume autofill from a free-text career blurb — the headline feature
# ---------------------------------------------------------------------------

class AutofillRequest(BaseModel):
    rawText: str
    name: Optional[str] = ""
    targetTitle: Optional[str] = ""


SCHEMA_HINT = """{
  "title": "<best-fit job title/headline for this candidate>",
  "summary": "<2-3 sentence professional summary, under 60 words>",
  "skills": "<comma-separated list of skills mentioned or clearly implied>",
  "experience": [
    {
      "company": "<company name as given>",
      "role": "<job title as given>",
      "start": "<YYYY-MM if a month+year or clear date was given, else \\"\\">",
      "end": "<YYYY-MM, \\"Present\\" if current, or \\"\\" if unknown>",
      "bullets": "<3-4 achievement-style bullet lines, each starting with a past-tense action verb, separated by \\n, no leading dashes>"
    }
  ],
  "education": [
    { "degree": "<degree/field>", "school": "<institution>", "year": "<graduation year or \\"\\">", "gpa": "" }
  ],
  "certs": "<one certification per line, or empty string if none mentioned>",
  "langs": "<comma-separated languages, or empty string if none mentioned>",
  "projects": [
    { "name": "<project name>", "tech": "<tech used, or empty string>", "desc": "<1-2 sentence description>", "link": "" }
  ]
}"""


@router.post("/autofill")
def ai_autofill(body: AutofillRequest):
    if not body.rawText or len(body.rawText.strip()) < 20:
        raise HTTPException(
            status_code=400,
            detail="Paste a bit more about your background first — a few sentences on your roles, skills, and education is enough.",
        )

    prompt = f"""You are an expert resume writer. A candidate has pasted a rough, unstructured description of their career below. Turn it into structured resume content.

STRICT RULES:
- Use ONLY facts present in or directly implied by the candidate's text. Never invent a company, school, date, or number that wasn't stated or clearly implied.
- If dates aren't given for a role, leave "start"/"end" as empty strings rather than guessing years.
- If the candidate lists no education, return an empty "education" array. Same for "experience" and "projects" — empty arrays if nothing applies, don't pad with placeholders.
- Bullets: strong past-tense action verbs, quantify impact only where the candidate mentioned or clearly implied a number — otherwise describe scope/impact qualitatively. Never fabricate metrics.
- "skills" should reflect tools/skills actually mentioned or unambiguously implied by the work described — don't pad with generic buzzwords.
- Write the summary in third-person-implied resume style (no "I"), confident, specific, no clichés.
- Return ONLY valid JSON matching this exact shape, no markdown fences, no commentary:
{SCHEMA_HINT}

Candidate's name: {body.name or 'N/A'}
Candidate's target job title (use to focus tone/summary if given, otherwise infer the best-fit title from their background): {body.targetTitle or 'N/A (infer one)'}

CANDIDATE'S RAW BACKGROUND TEXT:
\"\"\"
{body.rawText.strip()}
\"\"\""""

    try:
        raw = generate_text(prompt, max_output_tokens=3000)
        try:
            result = extract_json(raw)
        except Exception:
            raise ValueError("The AI response couldn't be parsed. Please try again.")

        import time
        now_ms = int(time.time() * 1000)

        def norm_exp(items, offset):
            out = []
            for i, e in enumerate(items or []):
                out.append({
                    "id": now_ms + offset + i,
                    "company": e.get("company", "") if isinstance(e, dict) else "",
                    "role": e.get("role", "") if isinstance(e, dict) else "",
                    "start": e.get("start", "") if isinstance(e, dict) else "",
                    "end": e.get("end", "") if isinstance(e, dict) else "",
                    "bullets": e.get("bullets", "") if isinstance(e, dict) else "",
                })
            return out

        def norm_edu(items, offset):
            out = []
            for i, e in enumerate(items or []):
                out.append({
                    "id": now_ms + offset + i,
                    "degree": e.get("degree", "") if isinstance(e, dict) else "",
                    "school": e.get("school", "") if isinstance(e, dict) else "",
                    "year": e.get("year", "") if isinstance(e, dict) else "",
                    "gpa": e.get("gpa", "") if isinstance(e, dict) else "",
                })
            return out

        def norm_proj(items, offset):
            out = []
            for i, p in enumerate(items or []):
                out.append({
                    "id": now_ms + offset + i,
                    "name": p.get("name", "") if isinstance(p, dict) else "",
                    "tech": p.get("tech", "") if isinstance(p, dict) else "",
                    "desc": p.get("desc", "") if isinstance(p, dict) else "",
                    "link": p.get("link", "") if isinstance(p, dict) else "",
                })
            return out

        return {
            "title": result.get("title") or "",
            "summary": result.get("summary") or "",
            "skills": result.get("skills") or "",
            "certs": result.get("certs") or "",
            "langs": result.get("langs") or "",
            "experience": norm_exp(result.get("experience"), 0),
            "education": norm_edu(result.get("education"), 1000),
            "projects": norm_proj(result.get("projects"), 2000),
        }
    except Exception as err:
        raise ai_error(err)
