"""QA (Question Answering) routes for the API."""

import time
import uuid

from fastapi import APIRouter, HTTPException, status

from ... import database
from ...database import get_admin_connection
from ...knowledge.graph import QATracker
from ..models import (
    CitedChunk,
    QueryHistoryResponse,
    QueryRequest,
    QueryResponse,
)

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

        # Build cited chunks if requested
        cited_chunks = []
        if request.include_citations and result.get("context"):
            # Parse context to extract chunk references
            context_data = result.get("context", {})
            chunk_ids = context_data.get("chunk_ids", [])

            for chunk_id in chunk_ids[: request.max_context_chunks]:
                chunk = database.get_chunk_by_id(conn, chunk_id)
                if chunk:
                    cited_chunks.append(
                        CitedChunk(
                            tree_id=chunk["tree_id"],
                            content=chunk["content"][:500],  # Truncate for response
                            score=chunk.get("relevance_score", 0.5),
                            page_number=chunk.get("page_number"),
                            chapter=chunk.get("chapter"),
                        )
                    )

        return QueryResponse(
            question=request.question,
            answer=result.get("answer", ""),
            session_id=session_id,
            confidence=result.get("confidence", 0.0),
            cited_concept_ids=result.get("cited_concept_ids", []),
            cited_chunks=cited_chunks,
            focus_concept_id=result.get("focus_concept_id"),
            context_summary=result.get("context_summary"),
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process question: {str(e)}",
        )
    finally:
        if conn:
            conn.close()


@router.get(
    "/history/{session_id}",
    response_model=QueryHistoryResponse,
    summary="Get QA history for a session",
    description="Retrieve the conversation history for a specific QA session.",
)
async def get_session_history(
    session_id: str,
    limit: int = 10,
):
    """Get QA history for a session.

    Args:
        session_id: The session ID
        limit: Maximum number of queries to return

    Returns:
        QueryHistoryResponse with the conversation history
    """
    conn = None
    try:
        conn = get_admin_connection()
        tracker = QATracker(conn)

        history = tracker.get_history(session_id)

        # Format history items
        queries = []
        for item in history[:limit]:
            queries.append(
                {
                    "id": item.id,
                    "question": item.question,
                    "answer": item.answer,
                    "confidence": item.confidence,
                    "focus_concept_id": item.focus_concept_id,
                    "cited_concept_ids": item.cited_concept_ids,
                    "timestamp": item.timestamp if hasattr(item, "timestamp") else None,
                }
            )

        return QueryHistoryResponse(
            session_id=session_id,
            queries=queries,
            total=len(history),
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve history: {str(e)}",
        )
    finally:
        if conn:
            conn.close()


@router.post(
    "/sessions",
    response_model=dict,
    summary="Create a new QA session",
    description="Create a new QA session and return the session ID.",
)
async def create_session():
    """Create a new QA session.

    Returns:
        Dictionary with the new session_id
    """
    conn = None
    try:
        conn = get_admin_connection()
        tracker = QATracker(conn)

        session_id = tracker.create_session()

        return {"session_id": session_id, "created_at": time.time()}

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create session: {str(e)}",
        )
    finally:
        if conn:
            conn.close()
