"""
Vercel Serverless Function Entry Point for WattWise Classrooms API.

This adapts the FastAPI app for Vercel's Python serverless runtime.
Key differences from the long-running server:
- No background threads or thread pools
- No startup schema migrations (handled by Supabase)
- Per-request database sessions
- Stateless request handling
"""

import os
import sys
from pathlib import Path

# Add the backend app to the path
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# Set required environment variables for Vercel
os.environ.setdefault("MCS_DATABASE_URL", os.environ.get("DATABASE_URL", ""))
os.environ.setdefault("MCS_FRONTEND_URL", os.environ.get("FRONTEND_URL", "https://wattwise-classrooms-uzi-siegfrieds-projects.vercel.app"))
os.environ.setdefault("MCS_SECURE_COOKIES", "true")

# Import and configure the serverless app
from app.serverless_main import app  # noqa: E402

# Vercel expects the app to be exported as `app`
# The ASGI handler will be automatically detected