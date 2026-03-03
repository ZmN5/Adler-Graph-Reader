"""
UI Backend for Adler Graph Reader.

This module serves as the entry point for the web UI backend.
It provides:
- FastAPI application with CORS
- Static file serving for the frontend build
- Proxy to the core API
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Import the core API
from src.adler_graph_reader.api.main import create_app as create_core_app
from src.adler_graph_reader import database


# Get the project root and frontend dist path
PROJECT_ROOT = Path(__file__).parent.parent.parent
FRONTEND_DIST = PROJECT_ROOT / "ui" / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup - initialize database
    database.init_database()
    yield
    # Shutdown


def create_ui_app() -> FastAPI:
    """Create the UI backend application."""
    app = FastAPI(
        title="Adler Graph Reader UI",
        description="Web UI for Adler Graph Reader - Knowledge Graph Visualization",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS middleware - allow all origins for development
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include the core API routes under /api/v1
    core_app = create_core_app()
    for route in core_app.routes:
        app.routes.append(route)

    # Serve static files from frontend dist directory (if it exists)
    if FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {
            "status": "healthy",
            "version": "1.0.0",
            "service": "adler-graph-reader-ui",
        }

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve the frontend SPA."""
        # If it's an API request, let it pass through
        if full_path.startswith("api/") or full_path == "health":
            return {"detail": "Not Found"}

        # Try to serve the requested file
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)

        # Otherwise serve index.html for SPA routing
        index_path = FRONTEND_DIST / "index.html"
        if index_path.exists():
            return FileResponse(index_path)

        # Frontend not built yet
        return {
            "message": "Frontend not built yet",
            "build_instructions": "cd ui/frontend && npm install && npm run build",
        }

    return app


app = create_ui_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
