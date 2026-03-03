"""Document routes for the API."""

from fastapi import APIRouter, HTTPException

from ... import database
from ..models import DocumentDetailResponse, DocumentListResponse, DocumentInfo

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=DocumentListResponse)
async def list_documents() -> DocumentListResponse:
    """List all documents in the database."""
    conn = database.get_connection()
    cursor = conn.cursor()

    # Get distinct document IDs with chunk counts
    cursor.execute(
        """
        SELECT document_id, COUNT(*) as chunk_count, MIN(created_at) as created_at
        FROM document_tree
        WHERE type = 'chunk'
        GROUP BY document_id
        ORDER BY created_at DESC
        """
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
    stats = {row[0]: {"theme_count": row[1], "concept_count": row[2], "relation_count": row[3]} for row in cursor.fetchall()}
    
    conn.close()

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

    return DocumentListResponse(documents=documents, total=len(documents))


@router.get("/{document_id}", response_model=DocumentDetailResponse)
async def get_document(document_id: str) -> DocumentDetailResponse:
    """Get detailed information about a specific document."""
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    # Check if document exists
    cursor.execute(
        "SELECT COUNT(*) FROM document_tree WHERE document_id = ?",
        (document_id,),
    )
    count = cursor.fetchone()[0]

    if count == 0:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found")

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

    conn.close()

    return DocumentDetailResponse(
        document_id=document_id,
        chunk_count=chunk_count,
        themes=themes,
        concepts=concepts,
        relations=relations,
    )