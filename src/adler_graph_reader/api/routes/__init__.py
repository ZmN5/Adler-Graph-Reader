"""API routes package."""

from fastapi import APIRouter

from .concepts import router as concepts_router
from .documents import router as documents_router
from .graph import router as graph_router
from .qa import router as qa_router
from .relations import router as relations_router
from .search import router as search_router

router = APIRouter()

# Include all sub-routers
router.include_router(documents_router, tags=["documents"])
router.include_router(concepts_router, tags=["concepts"])
router.include_router(relations_router, tags=["relations"])
router.include_router(search_router, tags=["search"])
router.include_router(qa_router, tags=["qa"])
router.include_router(graph_router, tags=["graph"])
