"""Concept routes for the API."""

from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from ... import database
from ..models import (
    ConceptDetailResponse,
    ConceptListRequest,
    ConceptListResponse,
    ConceptRelatedResponse,
    RelatedConcept,
    ConceptRelationDetail,
)

router = APIRouter(prefix="/concepts", tags=["concepts"])


def _concept_to_dict(concept: dict[str, Any]) -> dict[str, Any]:
    """Convert database concept to dict."""
    definition = concept.get("definition", "")
    return {
        "id": concept["id"],
        "name": concept["name"],
        "definition": definition[:200] + "..." if len(definition) > 200 else definition,
        "full_definition": definition,
        "category": concept.get("category", "concept"),
        "importance_score": concept.get("importance_score", 0.5),
        "theme_id": concept.get("theme_id"),
        "document_id": concept.get("document_id"),
    }


@router.get("", response_model=ConceptListResponse)
async def list_concepts(
    document_id: str | None = Query(None, description="Filter by document ID"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    category: str | None = Query(None, description="Filter by category"),
    theme_id: int | None = Query(None, description="Filter by theme ID"),
    sort_by: str = Query(
        "importance", description="Sort field (importance, name, created)"
    ),
    sort_order: str = Query("desc", description="Sort order (asc, desc)"),
) -> ConceptListResponse:
    """List concepts with optional filtering and pagination."""
    conn = database.get_connection()
    cursor = conn.cursor()

    try:
        # Build WHERE clause
        where_clauses = []
        params = []

        if document_id:
            where_clauses.append("document_id = ?")
            params.append(document_id)
        if category:
            where_clauses.append("category = ?")
            params.append(category)
        if theme_id:
            where_clauses.append("theme_id = ?")
            params.append(theme_id)

        where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

        # Get total count
        count_sql = f"SELECT COUNT(*) FROM concepts {where_sql}"
        cursor.execute(count_sql, params)
        total = cursor.fetchone()[0]

        # Determine sort column
        sort_column = {
            "importance": "importance_score",
            "name": "name",
            "created": "id",
        }.get(sort_by, "importance_score")

        order_sql = "DESC" if sort_order.lower() == "desc" else "ASC"

        # Get paginated results
        offset = (page - 1) * page_size
        query_sql = f"""
            SELECT id, document_id, theme_id, name, definition,
                   importance_score, category
            FROM concepts
            {where_sql}
            ORDER BY {sort_column} {order_sql}
            LIMIT ? OFFSET ?
        """
        cursor.execute(query_sql, params + [page_size, offset])

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


@router.post("/search", response_model=ConceptListResponse)
async def search_concepts(request: ConceptListRequest) -> ConceptListResponse:
    """Search concepts by name or definition with advanced filtering."""
    conn = database.get_connection()
    cursor = conn.cursor()

    try:
        # Build WHERE clause
        where_clauses = []
        params = []

        if request.search:
            where_clauses.append("(name LIKE ? OR definition LIKE ?)")
            search_pattern = f"%{request.search}%"
            params.extend([search_pattern, search_pattern])

        if request.theme_id:
            where_clauses.append("theme_id = ?")
            params.append(request.theme_id)

        if request.category:
            where_clauses.append("category = ?")
            params.append(request.category)

        where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

        # Get total count
        count_sql = f"SELECT COUNT(*) FROM concepts {where_sql}"
        cursor.execute(count_sql, params)
        total = cursor.fetchone()[0]

        # Determine sort column
        sort_column = {
            "importance": "importance_score",
            "name": "name",
            "created": "id",
        }.get(request.sort_by, "importance_score")

        order_sql = "DESC" if request.sort_order.lower() == "desc" else "ASC"

        # Get paginated results
        limit = request.page_size
        query_sql = f"""
            SELECT id, document_id, theme_id, name, definition,
                   importance_score, category
            FROM concepts
            {where_sql}
            ORDER BY {sort_column} {order_sql}
            LIMIT ?
        """
        cursor.execute(query_sql, params + [limit])

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
            page=1,
            page_size=limit,
            has_more=False,
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
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Concept {concept_id} not found",
            )

        # Get neighbors and relations
        neighbors_data = database.get_concept_relations(conn, concept_id)

        # Get neighbor details and build relation info
        neighbor_ids = set()
        relation_map = {}

        for rel in neighbors_data:
            if rel["source_concept_id"] != concept_id:
                neighbor_ids.add(rel["source_concept_id"])
                relation_map[rel["source_concept_id"]] = {
                    "type": rel["relation_type"],
                    "strength": rel.get("strength", 0.5),
                }
            if rel["target_concept_id"] != concept_id:
                neighbor_ids.add(rel["target_concept_id"])
                relation_map[rel["target_concept_id"]] = {
                    "type": rel["relation_type"],
                    "strength": rel.get("strength", 0.5),
                }

        neighbors = []
        for nid in neighbor_ids:
            n = database.get_concept_by_id(conn, nid)
            if n:
                definition = n.get("definition", "")
                rel_info = relation_map.get(nid, {})
                neighbors.append(
                    RelatedConcept(
                        id=n["id"],
                        name=n["name"],
                        definition=definition[:100] + "..."
                        if len(definition) > 100
                        else definition,
                        category=n.get("category", "concept"),
                        importance_score=n.get("importance_score", 0.5),
                        relation_type=rel_info.get("type"),
                        relation_strength=rel_info.get("strength"),
                    )
                )

        # Format relations
        relations = [
            ConceptRelationDetail(
                id=rel["id"],
                source_concept_id=rel["source_concept_id"],
                target_concept_id=rel["target_concept_id"],
                relation_type=rel["relation_type"],
                strength=rel.get("strength", 0.5),
                evidence=rel.get("evidence"),
                explanation=rel.get("explanation"),
            )
            for rel in neighbors_data
        ]

        # Get related documents
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT document_id FROM concepts WHERE id = ?",
            (concept_id,),
        )
        doc_row = cursor.fetchone()
        related_documents = [doc_row[0]] if doc_row else []

        return ConceptDetailResponse(
            concept=concept,
            neighbors=neighbors,
            relations=relations,
            related_documents=related_documents,
        )
    finally:
        conn.close()


@router.get("/{concept_id}/related", response_model=ConceptRelatedResponse)
async def get_related_concepts(
    concept_id: int,
    max_depth: int = Query(1, ge=1, le=3, description="Maximum depth of relationships"),
    limit: int = Query(20, ge=1, le=50, description="Maximum number of nodes"),
    relation_types: str | None = Query(
        None, description="Comma-separated relation types"
    ),
) -> ConceptRelatedResponse:
    """Get related concepts as a graph structure.

    This endpoint returns the concept and its related concepts as nodes and edges,
    suitable for graph visualization.
    """
    conn = database.get_admin_connection()

    try:
        # Check if concept exists
        concept = database.get_concept_by_id(conn, concept_id)
        if not concept:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Concept {concept_id} not found",
            )

        # Parse relation types filter
        allowed_relation_types = None
        if relation_types:
            allowed_relation_types = [t.strip() for t in relation_types.split(",")]

        # BFS to find related concepts up to max_depth
        visited = {concept_id}
        queue = [(concept_id, 0)]  # (concept_id, depth)
        nodes = {}
        edges = []

        # Add root node
        nodes[concept_id] = {
            "id": concept_id,
            "label": concept["name"],
            "node_type": "concept",
            "importance": concept.get("importance_score", 0.5),
            "description": concept.get("definition", "")[:100],
            "depth": 0,
        }

        while queue and len(nodes) < limit:
            current_id, depth = queue.pop(0)

            if depth >= max_depth:
                continue

            # Get relations for current concept
            relations = database.get_concept_relations(conn, current_id)

            for rel in relations:
                # Filter by relation type if specified
                if (
                    allowed_relation_types
                    and rel["relation_type"] not in allowed_relation_types
                ):
                    continue

                # Determine neighbor ID
                if rel["source_concept_id"] == current_id:
                    neighbor_id = rel["target_concept_id"]
                else:
                    neighbor_id = rel["source_concept_id"]

                # Add edge
                edges.append(
                    {
                        "source": str(current_id),
                        "target": str(neighbor_id),
                        "relation_type": rel["relation_type"],
                        "strength": rel.get("strength", 0.5),
                        "label": rel["relation_type"],
                    }
                )

                # Add neighbor node if not visited
                if neighbor_id not in visited and len(nodes) < limit:
                    visited.add(neighbor_id)
                    neighbor = database.get_concept_by_id(conn, neighbor_id)
                    if neighbor:
                        nodes[neighbor_id] = {
                            "id": neighbor_id,
                            "label": neighbor["name"],
                            "node_type": "concept",
                            "importance": neighbor.get("importance_score", 0.5),
                            "description": neighbor.get("definition", "")[:100],
                            "depth": depth + 1,
                        }
                        queue.append((neighbor_id, depth + 1))

        return ConceptRelatedResponse(
            concept_id=concept_id,
            nodes=list(nodes.values()),
            edges=edges,
            total_nodes=len(nodes),
            total_edges=len(edges),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve related concepts: {str(e)}",
        )
    finally:
        conn.close()


@router.get("/{concept_id}/chunks", response_model=list[dict[str, Any]])
async def get_concept_chunks(
    concept_id: int,
    limit: int = Query(10, ge=1, le=20),
):
    """Get chunks that reference this concept.

    Returns the source text chunks where this concept appears.
    """
    conn = database.get_admin_connection()

    try:
        # Check if concept exists
        concept = database.get_concept_by_id(conn, concept_id)
        if not concept:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Concept {concept_id} not found",
            )

        # Get source chunk IDs from concept
        source_chunk_ids = concept.get("source_chunk_ids", [])

        if not source_chunk_ids:
            return []

        # Fetch chunk details
        chunks = []
        for chunk_id in source_chunk_ids[:limit]:
            chunk = database.get_chunk_by_id(conn, chunk_id)
            if chunk:
                chunks.append(
                    {
                        "tree_id": chunk["tree_id"],
                        "content": chunk["content"],
                        "page_number": chunk.get("page_number"),
                        "chapter": chunk.get("chapter"),
                        "section": chunk.get("section"),
                    }
                )

        return chunks

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve concept chunks: {str(e)}",
        )
    finally:
        conn.close()
