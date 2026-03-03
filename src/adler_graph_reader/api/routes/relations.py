"""
Relations API routes.
"""

from fastapi import APIRouter, HTTPException, Query

from ... import database
from ..models import RelationListResponse

router = APIRouter(prefix="/relations", tags=["relations"])


@router.get("", response_model=RelationListResponse)
async def list_relations(
    document_id: str = Query(..., description="Document ID to filter by"),
) -> RelationListResponse:
    """List all relations for a document."""
    conn = database.get_admin_connection()
    try:
        relations_data = database.get_relations(conn, document_id)

        return RelationListResponse(
            relations=relations_data,
            total=len(relations_data),
        )
    finally:
        conn.close()


@router.get("/concept/{concept_id}", response_model=RelationListResponse)
async def get_concept_relations(
    concept_id: int,
) -> RelationListResponse:
    """Get all relations for a specific concept."""
    conn = database.get_admin_connection()
    try:
        # Verify concept exists
        concept = database.get_concept_by_id(conn, concept_id)
        if not concept:
            raise HTTPException(
                status_code=404, detail=f"Concept {concept_id} not found"
            )

        relations_data = database.get_concept_relations(conn, concept_id)

        return RelationListResponse(
            relations=relations_data,
            total=len(relations_data),
        )
    finally:
        conn.close()
