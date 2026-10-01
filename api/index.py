"""Vercel serverless entry point.

`installCommand` in vercel.json copies mcs/backend/app to api/app so every
import resolves inside the function bundle. Same FastAPI app as Render.
"""
from app.main import app  # noqa: F401
