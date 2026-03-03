"""
Relations API routes.
"""

from fastapi import APIRouter, HTTPException, Query, status

from ... import database
from ..models import RelationFilterRequest, RelationListResponse

router = APIRouter(prefix="/relations", tags=["relations"])


@router.get("", response_model=RelationListResponse)
async def list_relations(
    document_id: str | None = Query(None, description="Document ID to filter by"),
    source_concept_id: int | None = Query(None, description="Source concept ID"),
    target_concept_id: int | None = Query(None, description="Target concept ID"),
    relation_type: str | None = Query(None, description="Filter by relation type"),
    min_strength: float | None = Query(
        None, ge=0.0, le=1.0, description="Minimum relation strength"
    ),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> RelationListResponse:
    """List all relations with optional filtering and pagination.

    Supports filtering by document, source/target concepts, relation type, and strength.
    """
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    try:
        # Build WHERE clause dynamically
        where_clauses = []
        params = []

        if document_id:
            where_clauses.append("document_id = ?")
            params.append(document_id)
        if source_concept_id:
            where_clauses.append("source_concept_id = ?")
            params.append(source_concept_id)
        if target_concept_id:
            where_clauses.append("target_concept_id = ?")
            params.append(target_concept_id)
        if relation_type:
            where_clauses.append("relation_type = ?")
            params.append(relation_type)
        if min_strength is not None:
            where_clauses.append("strength >= ?")
            params.append(min_strength)

        where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

        # Get total count
        count_sql = f"SELECT COUNT(*) FROM concept_relations {where_sql}"
        cursor.execute(count_sql, params)
        total = cursor.fetchone()[0]

        # Get paginated results
        offset = (page - 1) * page_size
        query_sql = f"""
            SELECT id, document_id, source_concept_id, target_concept_id,
                   relation_type, strength, evidence, explanation
            FROM concept_relations
            {where_sql}
            ORDER BY strength DESC
            LIMIT ? OFFSET ?
        """
        cursor.execute(query_sql, params + [page_size, offset])

        rows = cursor.fetchall()
        relations = [
            {
                "id": row[0],
                "document_id": row[1],
                "source_concept_id": row[2],
                "target_concept_id": row[3],
                "relation_type": row[4],
                "strength": row[5],
                "evidence": row[6],
                "explanation": row[7],
            }
            for row in rows
        ]

        return RelationListResponse(
            relations=relations,
            total=total,
            page=page,
            page_size=page_size,
            has_more=(page * page_size) < total,
        )
    finally:
        conn.close()


@router.post("/filter", response_model=RelationListResponse)
async def filter_relations(request: RelationFilterRequest) -> RelationListResponse:
    """Filter relations using POST request with complex criteria."""
    return await list_relations(
        document_id=request.document_id,
        source_concept_id=request.source_concept_id,
        target_concept_id=request.target_concept_id,
        relation_type=request.relation_type,
        min_strength=request.min_strength,
        page=request.page,
        page_size=request.page_size,
    )


@router.get("/concept/{concept_id}", response_model=RelationListResponse)
async def get_concept_relations(
    concept_id: int,
    relation_type: str | None = Query(None, description="Filter by relation type"),
    min_strength: float | None = Query(
        None, ge=0.0, le=1.0, description="Minimum strength"
    ),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> RelationListResponse:
    """Get all relations for a specific concept with filtering.

    Args:
        concept_id: The concept ID
        relation_type: Optional filter by relation type
        min_strength: Optional minimum strength filter
        page: Page number for pagination
        page_size: Items per page

    Returns:
        Paginated list of relations
    """
    conn = database.get_admin_connection()
    try:
        # Verify concept exists
        concept = database.get_concept_by_id(conn, concept_id)
        if not concept:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Concept {concept_id} not found",
            )

        # Get all relations for this concept
        relations_data = database.get_concept_relations(conn, concept_id)

        # Apply filters
        filtered = relations_data
        if relation_type:
            filtered = [r for r in filtered if r["relation_type"] == relation_type]
        if min_strength is not None:
            filtered = [r for r in filtered if r.get("strength", 0) >= min_strength]

        # Sort by strength
        filtered.sort(key=lambda x: x.get("strength", 0), reverse=True)

        # Apply pagination
        total = len(filtered)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated = filtered[start_idx:end_idx]

        return RelationListResponse(
            relations=paginated,
            total=total,
            page=page,
            page_size=page_size,
            has_more=end_idx < total,
        )
    finally:
        conn.close()


@router.get("/types", response_model=list[str])
async def get_relation_types():
    """Get all unique relation types in the database.

    Returns:
        List of relation type strings
    """
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            "SELECT DISTINCT relation_type FROM concept_relations ORDER BY relation_type"
        )
        types = [row[0] for row in cursor.fetchall()]
        return types
    finally:
        conn.close()


@router.get("/stats/{document_id}", response_model=dict)
async def get_relation_stats(document_id: str):
    """Get relation statistics for a document.

    Args:
        document_id: The document ID

    Returns:
        Statistics about relations including counts by type
    """
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    try:
        # Total relations
        cursor.execute(
            "SELECT COUNT(*) FROM concept_relations WHERE document_id = ?",
            (document_id,),
        )
        total = cursor.fetchone()[0]

        # Relations by type
        cursor.execute(
            """
            SELECT relation_type, COUNT(*) as count
            FROM concept_relations
            WHERE document_id = ?
            GROUP BY relation_type
            ORDER BY count DESC
            """,
            (document_id,),
        )
        by_type = {row[0]: row[1] for row in cursor.fetchall()}

        # Average strength
        cursor.execute(
            "SELECT AVG(strength) FROM concept_relations WHERE document_id = ?",
            (document_id,),
        )
        avg_strength = cursor.fetchone()[0] or 0.0

        # Strongest relations
        cursor.execute(
            """
            SELECT source_concept_id, target_concept_id, relation_type, strength
            FROM concept_relations
            WHERE document_id = ?
            ORDER BY strength DESC
            LIMIT 5
            """,
            (document_id,),
        )
        strongest = [
            {
                "source": row[0],
                "target": row[1],
                "type": row[2],
                "strength": row[3],
            }
            for row in cursor.fetchall()
        ]

        return {
            "document_id": document_id,
            "total_relations": total,
            "by_type": by_type,
            "average_strength": round(avg_strength, 3),
            "strongest_relations": strongest,
        }
    finally:
        conn.close()
