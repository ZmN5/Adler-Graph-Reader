"""QA (Question Answering) routes for the API."""

import uuid

from fastapi import APIRouter, HTTPException, status

from ...database import get_admin_connection
from ...knowledge.graph import QATracker
from ..models import QueryRequest, QueryResponse

router = APIRouter(prefix="/qa", tags=["qa"])


@router.post(
    "",
    response_model=QueryResponse,
    summary="Ask a question about a document",
    description="Submit a natural language question and get an AI-generated answer based on the knowledge graph.",
)
async def ask_question(request: QueryRequest):
    """Ask a question about a document.

    Args:
        request: The query request containing question, document_id, and optional session_id

    Returns:
        QueryResponse with answer and metadata
    """
    conn = None
    try:
        conn = get_admin_connection()
        tracker = QATracker(conn)

        # Create new session if not provided
        session_id = request.session_id or str(uuid.uuid4())

        # Get answer from QA tracker
        result = tracker.ask(
            document_id=request.document_id,
            question=request.question,
            session_id=session_id,
        )

        return QueryResponse(
            question=request.question,
            answer=result.get("answer", ""),
            session_id=session_id,
            confidence=result.get("confidence", 0.0),
            cited_concept_ids=result.get("cited_concept_ids", []),
            focus_concept_id=result.get("focus_concept_id"),
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process question: {str(e)}",
        )
    finally:
        if conn:
            conn.close()
