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

    # Default: allow all common local development servers
    return [
        "http://localhost:3000",  # Vite dev server (this project)
        "http://localhost:5173",  # Vite default port
        "http://localhost:8000",  # FastAPI server itself
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
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
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "Accept",
            "Origin",
            "X-Requested-With",
            "Access-Control-Request-Method",
            "Access-Control-Request-Headers",
        ],
        expose_headers=["Content-Length", "Content-Type"],
        max_age=600,  # Cache preflight requests for 10 minutes
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
