"""
FastAPI application entry point for Adler-Graph-Reader API.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .. import database
from .routes import router


def get_allowed_origins() -> list[str]:
    """Get allowed CORS origins from environment or use defaults.

    Default allows only localhost development servers.
    Production should set ALLOWED_ORIGINS env var explicitly.
    """
    allowed_origins_env = os.environ.get("ALLOWED_ORIGINS")

    if allowed_origins_env:
        # Parse comma-separated origins
        return [origin.strip() for origin in allowed_origins_env.split(",")]

    # Default: only allow local development servers
    return [
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # React dev server
    ]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    database.init_database()
    yield
    # Shutdown


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Adler Graph Reader API",
        description="REST API for accessing knowledge graph functionality",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS middleware - restrict to specific origins
    allowed_origins = get_allowed_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "Accept"],
    )

    # Health check endpoint (before router to avoid prefix)
    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "version": "0.1.0"}

    # Include routers
    app.include_router(router, prefix="/api")

    return app


app = create_app()
