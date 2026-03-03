"""Concept routes for the API."""

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ... import database
from ..models import (
    ConceptDetailResponse,
    ConceptListResponse,
    ConceptListRequest,
)

router = APIRouter(prefix="/concepts", tags=["concepts"])


def _concept_to_dict(concept: dict[str, Any]) -> dict[str, Any]:
    """Convert database concept to dict."""
    return {
        "id": concept["id"],
        "name": concept["name"],
        "definition": concept["definition"][:200] + "..."
        if len(concept["definition"]) > 200
        else concept["definition"],
        "category": concept.get("category", "concept"),
        "importance_score": concept.get("importance_score", 0.5),
        "theme_id": concept.get("theme_id"),
    }


@router.get("", response_model=ConceptListResponse)
async def list_concepts(
    document_id: str | None = Query(None, description="Filter by document ID"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> ConceptListResponse:
    """List concepts with optional filtering and pagination."""
    conn = database.get_connection()
    cursor = conn.cursor()

    try:
        # Build query
        if document_id:
            cursor.execute(
                "SELECT COUNT(*) FROM concepts WHERE document_id = ?",
                (document_id,),
            )
        else:
            cursor.execute("SELECT COUNT(*) FROM concepts")

        total = cursor.fetchone()[0]

        # Get paginated results
        offset = (page - 1) * page_size
        if document_id:
            cursor.execute(
                """
                SELECT id, document_id, theme_id, name, definition,
                       importance_score, category
                FROM concepts WHERE document_id = ?
                ORDER BY importance_score DESC
                LIMIT ? OFFSET ?
                """,
                (document_id, page_size, offset),
            )
        else:
            cursor.execute(
                """
                SELECT id, document_id, theme_id, name, definition,
                       importance_score, category
                FROM concepts
                ORDER BY importance_score DESC
                LIMIT ? OFFSET ?
                """,
                (page_size, offset),
            )

        rows = cursor.fetchall()
        concepts = [
            {
                "id": row[0],
                "document_id": row[1],
                "theme_id": row[2],
                "name": row[3],
                "definition": row[4],
                "importance_score": row[5],
                "category": row[6],
            }
            for row in rows
        ]

        return ConceptListResponse(
            concepts=[_concept_to_dict(c) for c in concepts],
            total=total,
            page=page,
            page_size=page_size,
            has_more=(page * page_size) < total,
        )
    finally:
        conn.close()


@router.get("/{concept_id}", response_model=ConceptDetailResponse)
async def get_concept(concept_id: int) -> ConceptDetailResponse:
    """Get detailed information about a specific concept."""
    conn = database.get_admin_connection()

    try:
        concept = database.get_concept_by_id(conn, concept_id)
        if not concept:
            raise HTTPException(
                status_code=404, detail=f"Concept {concept_id} not found"
            )

        # Get neighbors and relations
        neighbors_data = database.get_concept_relations(conn, concept_id)

        # Get neighbor details
        neighbor_ids = set()
        for rel in neighbors_data:
            if rel["source_concept_id"] != concept_id:
                neighbor_ids.add(rel["source_concept_id"])
            if rel["target_concept_id"] != concept_id:
                neighbor_ids.add(rel["target_concept_id"])

        neighbors = []
        for nid in neighbor_ids:
            n = database.get_concept_by_id(conn, nid)
            if n:
                neighbors.append(
                    {
                        "id": n["id"],
                        "name": n["name"],
                        "definition": n["definition"][:100] + "..."
                        if len(n["definition"]) > 100
                        else n["definition"],
                        "category": n.get("category", "concept"),
                        "importance_score": n.get("importance_score", 0.5),
                    }
                )

        return ConceptDetailResponse(
            concept=concept,
            neighbors=neighbors,
            relations=neighbors_data,
        )
    finally:
        conn.close()


@router.post("/search", response_model=ConceptListResponse)
async def search_concepts(request: ConceptListRequest) -> ConceptListResponse:
    """Search concepts by name or definition."""
    conn = database.get_connection()
    cursor = conn.cursor()

    try:
        # Simple text search using LIKE
        search_pattern = f"%{request.search}%"
        limit = request.page_size

        cursor.execute(
            """
            SELECT id, document_id, theme_id, name, definition,
                   importance_score, category
            FROM concepts
            WHERE name LIKE ? OR definition LIKE ?
            ORDER BY importance_score DESC
            LIMIT ?
            """,
            (search_pattern, search_pattern, limit),
        )

        rows = cursor.fetchall()
        concepts = [
            {
                "id": row[0],
                "document_id": row[1],
                "theme_id": row[2],
                "name": row[3],
                "definition": row[4],
                "importance_score": row[5],
                "category": row[6],
            }
            for row in rows
        ]

        return ConceptListResponse(
            concepts=[_concept_to_dict(c) for c in concepts],
            total=len(concepts),
            page=1,
            page_size=limit,
            has_more=False,
        )
    finally:
        conn.close()
