from dotenv import load_dotenv
load_dotenv() 

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

if __package__:
    from .routes_ai import router as ai_router
    from .routes_build import router as build_router
else:
    from routes_ai import router as ai_router
    from routes_build import router as build_router

app = FastAPI(title="Resume Astra API")

# CORS middleware zaroori hai taaki frontend API ko call kar sake
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sirf API routes rahenge, static folder ka mount hata diya
app.include_router(ai_router)
app.include_router(build_router)

# Ek simple health check route (optional, but good for debugging)
@app.get("/api/health")
def health_check():
    return {"status": "Backend is running fine!"}