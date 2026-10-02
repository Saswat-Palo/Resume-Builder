from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # reads .env before anything touches GEMINI_API_KEY

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

if __package__:
    from .routes_ai import router as ai_router
    from .routes_build import router as build_router
else:
    from routes_ai import router as ai_router
    from routes_build import router as build_router

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Resume Astra API")

# Harmless in same-origin deployment; keeps things working if you ever split frontend/backend hosts.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes are registered first so they take priority over the catch-all static mount below.
app.include_router(ai_router)
app.include_router(build_router)

# Serves index.html at "/", and style.css / script.js alongside it, with SPA-style index fallback.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
