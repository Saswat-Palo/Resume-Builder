# Resume Astra (Python + vanilla JS)

**FastAPI (Python) backend + plain HTML/CSS/JS frontend.** No Node, no build step for the frontend — open `static/index.html` through the FastAPI server and it just works. All AI features run through Google Gemini via the official `google-genai` Python SDK.

## Why this stack

- The AI work (writing summaries, bullets, scoring resumes) is genuinely a backend/agent job — Python is a strong fit, and `google-genai`'s Python SDK is first-class.
- The frontend doesn't need a framework: it's a form + a live preview + a few modals. Plain JS keeps it dependency-free and fast to load.
- One process, one `pip install`, one `uvicorn` command to run everything.

## What's new in this version

- **AI Build tab (default)** — the user enters personal details, education and a target role (plus optional skills / experience notes) and presses **Generate my resume**. The AI writes the resume section by section and the **live preview builds in front of them** (summary types out, experience bullets appear line by line, skills pop in). A step tracker shows progress; *Skip animation* jumps to the finished result.
- **ATS check is hidden until the resume is generated**, then revealed (toolbar + sidebar). It scores the resume and, when facts are missing (no experience/projects, no numbers in achievements, thin skills…), shows **targeted questions**. Answering them and pressing *Update my resume* streams a refined resume into the preview and re-runs the ATS check, showing the score change.
- **Redesigned UI** — new "Aurora" design system (cobalt → violet → teal), Manrope + Inter typography, template switcher in the preview toolbar, cleaner cards, motion that respects `prefers-reduced-motion`.
- **Generate merges, never replaces.** Anything already typed into Work, Projects, Summary, Certifications, Languages and Skills is sent to the AI and merged with your notes: entries are polished in place (your company/role/project names and dates always win), new jobs/projects from the notes are added, and nothing is duplicated or dropped.
- **ATS check needs no input.** Opening it scores the resume on screen straight away (no job-description box); it only re-scores when the resume changed.
- **Light / dark mode.** A sun/moon button in the header switches themes. The choice is remembered; until you pick one, the app follows the device setting (and follows it live if it changes). The resume itself always stays a white page, so the PDF is identical in both themes. Both palettes meet WCAG AA contrast for text.
- **New logo.** `static/assets/` holds the supplied logo (`logo.png`), a dark-mode variant with the navy lettering turned light (`logo-dark.png`), the icon-only mark, favicons, an Apple touch icon and home-screen icons (`manifest.json`). Replace those files to re-brand; no code changes needed.
- **Mobile-first layout.** Below 900px the app shows one panel at a time with a bottom bar: *Edit* / *Preview*, plus *ATS* (once the resume is ready) and *PDF*. Building a resume switches to Preview automatically so you watch it write itself (with a Skip button); each view remembers its scroll position. Inputs are 16px (no iOS zoom), tap targets are 44px, modals become bottom sheets, safe-area insets are honoured on notched phones, and the page can be added to the home screen.
- Every previous feature is unchanged: Basics / Work / Edu / More tabs, paste-your-bio autofill, per-job bullet writer, summary regenerate, photo upload, three templates, autosave, Supabase sign-in + save, PDF export.

New endpoints: `POST /api/ai/build-stream` and `POST /api/ai/refine-stream` (Server-Sent Events, in `backend/routes_build.py`). `/api/ai/ats-check` accepts extra optional fields and now also returns `needsMoreInfo`; old clients keep working.

## What's included

- **AI autofill ("Let AI build your resume")** — paste a rough career blurb, get a structured draft: title, summary, skills, experience with achievement bullets, education, certs, languages, projects.
- **Per-entry bullet writer** — regenerate achievement bullets for any single job.
- **Summary regenerator**.
- **ATS Score Checker** — 0–100 score, strengths, improvements, missing keywords (optionally against a pasted job description).
- Photo upload with drag-and-drop + client-side compression, live preview that's always visible (sticky both panels), autosave to localStorage, toast notifications, Supabase Google sign-in + save, PDF export via html2pdf.js.

## Project structure

```
backend/
  main.py           FastAPI app — mounts /api/ai/* routes, serves static/ at "/"
  routes_ai.py       the 4 AI endpoints (autofill, summary, role-objective, ats-check)
  routes_build.py    streaming build-stream / refine-stream endpoints (SSE)
  gemini_service.py   Gemini client wrapper (model, JSON parsing, error handling)
static/
  index.html          all markup: forms, AI panel, ATS modal, live preview
  style.css            all styling (light theme, AI-branded accents)
  script.js             all frontend logic: state, rendering, fetch calls to /api/ai/*
requirements.txt
.env.example
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and add your real GEMINI_API_KEY

uvicorn backend.main:app --reload --port 8000
```

Open **http://localhost:8000** — that's it, frontend and backend are the same server.

### Environment variables (`.env`)

| Variable | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Yes, for AI features | Get a free key at aistudio.google.com/apikey. Without it, AI buttons show a clear error toast; everything else still works. |
| `GEMINI_MODEL` | No | Defaults to `gemini-3.5-flash`. On a 404 (retired model) or a 503 (overloaded), the backend automatically retries with `gemini-2.5-flash` then `gemini-3.1-flash-lite`, so you don't need to change this unless you want a specific model. |

### Supabase

Sign-in and "Save & Download" use the same demo Supabase project as earlier versions (hardcoded in `script.js` — look for `SUPABASE_URL` / `SUPABASE_ANON_KEY` near the top). Swap in your own project for production; the `resumes` table needs: `user_id, email, name, job_title, contact_email, phone, location, linkedin, website, summary, skills, certifications, languages, hobbies, experience, education, projects, template, photo_url, updated_at`.

## Verified

This was actually built and run in a real environment before delivery: `pip install -r requirements.txt` succeeds, `uvicorn backend.main:app` starts cleanly, and all routes (`/`, `/style.css`, `/script.js`, `/api/ai/summary`, `/api/ai/autofill`, etc.) respond correctly over real HTTP — including proper 400 validation errors when required fields are missing, rather than crashes or 404s.

## Deploying

Any host that runs a Python ASGI app works (Render, Railway, Fly.io, a VPS with `uvicorn`/`gunicorn`). Point it at the same `backend.main:app`, set `GEMINI_API_KEY` in the host's environment variables, and the `static/` folder ships alongside automatically since FastAPI serves it directly — no separate frontend deploy needed.
