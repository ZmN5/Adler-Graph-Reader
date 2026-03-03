"""Document routes for the API."""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status

from ... import database
from ..models import DocumentDetailResponse, DocumentListResponse, DocumentInfo

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    sort_by: str = Query("created_at", description="Sort field (created_at, name)"),
    sort_order: str = Query("desc", description="Sort order (asc, desc)"),
) -> DocumentListResponse:
    """List all documents in the database with pagination.

    Args:
        page: Page number (1-indexed)
        page_size: Number of items per page
        sort_by: Field to sort by (created_at, name)
        sort_order: Sort order (asc, desc)

    Returns:
        Paginated list of documents
    """
    conn = database.get_connection()
    cursor = conn.cursor()

    try:
        # Get total count
        cursor.execute(
            "SELECT COUNT(DISTINCT document_id) FROM document_tree WHERE type = 'chunk'"
        )
        total = cursor.fetchone()[0]

        # Determine sort column
        sort_column = {
            "created_at": "MIN(created_at)",
            "name": "document_id",
        }.get(sort_by, "MIN(created_at)")

        order_sql = "DESC" if sort_order.lower() == "desc" else "ASC"

        # Get paginated document IDs
        offset = (page - 1) * page_size
        cursor.execute(
            f"""
            SELECT document_id, COUNT(*) as chunk_count, MIN(created_at) as created_at
            FROM document_tree
            WHERE type = 'chunk'
            GROUP BY document_id
            ORDER BY {sort_column} {order_sql}
            LIMIT ? OFFSET ?
            """,
            (page_size, offset),
        )

        rows = cursor.fetchall()

        # Also get theme/concept/relation counts per document
        cursor.execute("""
            SELECT document_id,
                   (SELECT COUNT(*) FROM themes WHERE themes.document_id = document_tree.document_id) as theme_count,
                   (SELECT COUNT(*) FROM concepts WHERE concepts.document_id = document_tree.document_id) as concept_count,
                   (SELECT COUNT(*) FROM concept_relations WHERE concept_relations.document_id = document_tree.document_id) as relation_count
            FROM document_tree
            WHERE type = 'chunk'
            GROUP BY document_id
        """)
        stats = {
            row[0]: {
                "theme_count": row[1],
                "concept_count": row[2],
                "relation_count": row[3],
            }
            for row in cursor.fetchall()
        }

        documents = [
            DocumentInfo(
                document_id=row[0],
                chunk_count=row[1],
                theme_count=stats.get(row[0], {}).get("theme_count", 0),
                concept_count=stats.get(row[0], {}).get("concept_count", 0),
                relation_count=stats.get(row[0], {}).get("relation_count", 0),
            )
            for row in rows
        ]

        return DocumentListResponse(
            documents=documents,
            total=total,
        )
    finally:
        conn.close()


@router.get("/{document_id}", response_model=DocumentDetailResponse)
async def get_document(document_id: str) -> DocumentDetailResponse:
    """Get detailed information about a specific document."""
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    try:
        # Check if document exists
        cursor.execute(
            "SELECT COUNT(*) FROM document_tree WHERE document_id = ?",
            (document_id,),
        )
        count = cursor.fetchone()[0]

        if count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Document '{document_id}' not found",
            )

        # Get chunk count
        cursor.execute(
            "SELECT COUNT(*) FROM document_tree WHERE document_id = ? AND type = 'chunk'",
            (document_id,),
        )
        chunk_count = cursor.fetchone()[0]

        # Get themes
        themes = database.get_themes(conn, document_id)

        # Get concepts
        cursor.execute(
            "SELECT id, document_id, theme_id, name, definition, importance_score, category FROM concepts WHERE document_id = ?",
            (document_id,),
        )
        concept_rows = cursor.fetchall()
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
            for row in concept_rows
        ]

        # Get relations
        cursor.execute(
            "SELECT id, document_id, source_concept_id, target_concept_id, relation_type, strength, evidence FROM concept_relations WHERE document_id = ?",
            (document_id,),
        )
        relation_rows = cursor.fetchall()
        relations = [
            {
                "id": row[0],
                "document_id": row[1],
                "source_concept_id": row[2],
                "target_concept_id": row[3],
                "relation_type": row[4],
                "strength": row[5],
                "evidence": row[6],
            }
            for row in relation_rows
        ]

        return DocumentDetailResponse(
            document_id=document_id,
            chunk_count=chunk_count,
            themes=themes,
            concepts=concepts,
            relations=relations,
        )
    finally:
        conn.close()


@router.get("/{document_id}/chunks")
async def get_document_chunks(
    document_id: str,
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=200, description="Items per page"),
    chapter: str | None = Query(None, description="Filter by chapter"),
):
    """Get chunks for a document with pagination.

    Args:
        document_id: The document ID
        page: Page number
        page_size: Items per page
        chapter: Optional chapter filter

    Returns:
        Paginated list of chunks
    """
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    try:
        # Check if document exists
        cursor.execute(
            "SELECT COUNT(*) FROM document_tree WHERE document_id = ?",
            (document_id,),
        )
        if cursor.fetchone()[0] == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Document '{document_id}' not found",
            )

        # Build query
        where_clause = "WHERE document_id = ? AND type = 'chunk'"
        params = [document_id]

        if chapter:
            where_clause += " AND chapter = ?"
            params.append(chapter)

        # Get total count
        cursor.execute(
            f"SELECT COUNT(*) FROM document_tree {where_clause}",
            params,
        )
        total = cursor.fetchone()[0]

        # Get paginated chunks
        offset = (page - 1) * page_size
        cursor.execute(
            f"""
            SELECT tree_id, content, page_number, chapter, section, level
            FROM document_tree
            {where_clause}
            ORDER BY tree_id
            LIMIT ? OFFSET ?
            """,
            params + [page_size, offset],
        )

        rows = cursor.fetchall()
        chunks = [
            {
                "tree_id": row[0],
                "content": row[1],
                "page_number": row[2],
                "chapter": row[3],
                "section": row[4],
                "level": row[5],
            }
            for row in rows
        ]

        return {
            "chunks": chunks,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": (page * page_size) < total,
        }
    finally:
        conn.close()


@router.get("/{document_id}/chapters")
async def get_document_chapters(document_id: str):
    """Get all chapters for a document.

    Args:
        document_id: The document ID

    Returns:
        List of unique chapter names
    """
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            SELECT DISTINCT chapter
            FROM document_tree
            WHERE document_id = ? AND type = 'chunk' AND chapter IS NOT NULL
            ORDER BY tree_id
            """,
            (document_id,),
        )

        chapters = [row[0] for row in cursor.fetchall() if row[0]]
        return {"document_id": document_id, "chapters": chapters}
    finally:
        conn.close()


@router.get("/{document_id}/stats")
async def get_document_stats(document_id: str):
    """Get statistics for a document.

    Args:
        document_id: The document ID

    Returns:
        Document statistics
    """
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    try:
        # Check if document exists
        cursor.execute(
            "SELECT COUNT(*) FROM document_tree WHERE document_id = ?",
            (document_id,),
        )
        if cursor.fetchone()[0] == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Document '{document_id}' not found",
            )

        # Get basic stats
        cursor.execute(
            """
            SELECT
                COUNT(*) as chunk_count,
                AVG(LENGTH(content)) as avg_chunk_length,
                MIN(page_number) as min_page,
                MAX(page_number) as max_page
            FROM document_tree
            WHERE document_id = ? AND type = 'chunk'
            """,
            (document_id,),
        )
        row = cursor.fetchone()

        # Get knowledge graph stats
        cursor.execute(
            "SELECT COUNT(*) FROM themes WHERE document_id = ?",
            (document_id,),
        )
        theme_count = cursor.fetchone()[0]

        cursor.execute(
            "SELECT COUNT(*) FROM concepts WHERE document_id = ?",
            (document_id,),
        )
        concept_count = cursor.fetchone()[0]

        cursor.execute(
            "SELECT COUNT(*) FROM concept_relations WHERE document_id = ?",
            (document_id,),
        )
        relation_count = cursor.fetchone()[0]

        # Get concept categories distribution
        cursor.execute(
            """
            SELECT category, COUNT(*) as count
            FROM concepts
            WHERE document_id = ?
            GROUP BY category
            """,
            (document_id,),
        )
        categories = {row[0]: row[1] for row in cursor.fetchall()}

        return {
            "document_id": document_id,
            "chunks": {
                "count": row[0],
                "avg_length": round(row[1], 2) if row[1] else 0,
                "page_range": [row[2], row[3]] if row[2] and row[3] else None,
            },
            "knowledge_graph": {
                "themes": theme_count,
                "concepts": concept_count,
                "relations": relation_count,
                "categories": categories,
            },
        }
    finally:
        conn.close()


@router.get("/{document_id}/export")
async def export_document(
    document_id: str,
    format: str = Query(
        default="json", description="Export format: json, graphml, gexf, dot"
    ),
):
    """Export document knowledge graph to various formats.

    Args:
        document_id: The document ID
        format: Export format (json, graphml, gexf, dot)

    Returns:
        Exported graph data
    """
    import tempfile
    from fastapi.responses import FileResponse
    from ...knowledge.graph import KnowledgeGraph

    conn = database.get_admin_connection()

    try:
        # Check if document exists
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM document_tree WHERE document_id = ?",
            (document_id,),
        )
        if cursor.fetchone()[0] == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Document '{document_id}' not found",
            )

        kg = KnowledgeGraph(conn)

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / f"graph.{format}"

            if format == "json":
                kg.export_json(document_id, output_path)
                media_type = "application/json"
            elif format == "graphml":
                kg.export_graphml(document_id, output_path)
                media_type = "application/xml"
            elif format == "gexf":
                kg.export_gexf(document_id, output_path)
                media_type = "application/xml"
            elif format == "dot":
                kg.export_dot(document_id, output_path)
                media_type = "text/plain"
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported format: {format}",
                )

            return FileResponse(
                output_path,
                media_type=media_type,
                filename=f"{document_id}_graph.{format}",
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export document: {str(e)}",
        )
    finally:
        conn.close()
