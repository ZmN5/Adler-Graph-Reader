"""Search routes for hybrid search."""

import time

from fastapi import APIRouter, HTTPException, Query, status

from ... import database
from ...llm import get_default_client
from ...search.engine import HybridSearchEngine
from ..models import SearchRequest, SearchResponse, SearchResultItem

router = APIRouter(prefix="/search", tags=["search"])


@router.post("", response_model=SearchResponse)
async def search(request: SearchRequest):
    """
    Perform hybrid search combining BM25 and vector search.

    Returns chunks ranked by relevance to the query.
    Supports three search types:
    - fts: Full-text search only (fastest)
    - vector: Vector similarity search only
    - hybrid: Combined FTS + Vector with RRF fusion (default, best quality)
    """
    start_time = time.time()
    conn = database.get_admin_connection()

    try:
        # Initialize search engine
        llm_client = get_default_client()

        # Handle different search types
        if request.search_type == "fts":
            results = _fts_search_only(conn, request)
        elif request.search_type == "vector":
            results = _vector_search_only(conn, request, llm_client)
        else:  # hybrid (default)
            engine = HybridSearchEngine(
                conn=conn,
                llm_client=llm_client,
                use_reranker=request.use_reranker,
            )

            # Execute search
            search_results = engine.search(
                query=request.query,
                document_id=request.document_id,
                top_k=request.top_k,
            )

            # Convert to response model
            results = [
                SearchResultItem(
                    tree_id=r.tree_id,
                    content=r.content,
                    score=r.score,
                    context=r.context if request.include_context else [],
                    page_number=r.page_number,
                )
                for r in search_results
            ]

        took_ms = int((time.time() - start_time) * 1000)

        return SearchResponse(
            query=request.query,
            document_id=request.document_id,
            results=results,
            total=len(results),
            search_type=request.search_type,
            took_ms=took_ms,
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        )
    finally:
        conn.close()


def _fts_search_only(conn, request: SearchRequest) -> list[SearchResultItem]:
    """Perform full-text search only."""
    bm25_results = database.bm25_search(
        conn, request.query, request.document_id, limit=request.top_k
    )

    results = []
    for item in bm25_results:
        tree_id = item["tree_id"]
        chunk = database.get_chunk_by_id(conn, tree_id)
        if not chunk:
            continue

        context = []
        if request.include_context:
            siblings = database.get_sibling_chunks(conn, tree_id, limit=2)
            context = [s["content"] for s in siblings]

        results.append(
            SearchResultItem(
                tree_id=tree_id,
                content=chunk["content"],
                score=item.get("bm25_score", 0.0),
                context=context,
                page_number=chunk.get("page_number"),
                fts_score=item.get("bm25_score", 0.0),
            )
        )

    return results


def _vector_search_only(
    conn, request: SearchRequest, llm_client
) -> list[SearchResultItem]:
    """Perform vector search only."""
    query_embedding = llm_client.embed(request.query)
    vector_results = database.vector_search(
        conn,
        query_embedding,
        request.document_id,
        limit=request.top_k,
    )

    results = []
    for item in vector_results:
        tree_id = item["tree_id"]
        chunk = database.get_chunk_by_id(conn, tree_id)
        if not chunk:
            continue

        context = []
        if request.include_context:
            siblings = database.get_sibling_chunks(conn, tree_id, limit=2)
            context = [s["content"] for s in siblings]

        # Calculate similarity score from distance
        distance = item.get("distance", 1.0)
        similarity = 1.0 - distance

        results.append(
            SearchResultItem(
                tree_id=tree_id,
                content=chunk["content"],
                score=similarity,
                context=context,
                page_number=chunk.get("page_number"),
                vector_score=similarity,
            )
        )

    return results


@router.get("/suggest", response_model=list[str])
async def search_suggestions(
    q: str = Query(..., min_length=1, max_length=100, description="Query prefix"),
    document_id: str = Query(..., description="Document ID"),
    limit: int = Query(default=5, ge=1, le=10),
):
    """
    Get search suggestions based on concept names.

    Useful for autocomplete functionality.
    """
    conn = database.get_connection()
    cursor = conn.cursor()

    try:
        # Search for matching concepts
        search_pattern = f"%{q}%"
        cursor.execute(
            """
            SELECT DISTINCT name FROM concepts
            WHERE document_id = ? AND name LIKE ?
            ORDER BY importance_score DESC
            LIMIT ?
            """,
            (document_id, search_pattern, limit),
        )

        suggestions = [row[0] for row in cursor.fetchall()]
        return suggestions

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get suggestions: {str(e)}",
        )
    finally:
        conn.close()
