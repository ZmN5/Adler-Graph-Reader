"""Search routes for hybrid search."""

from fastapi import APIRouter, HTTPException, status

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
    """
    conn = database.get_admin_connection()

    try:
        # Initialize search engine
        llm_client = get_default_client()
        engine = HybridSearchEngine(
            conn=conn,
            llm_client=llm_client,
            use_reranker=request.use_reranker,
        )

        # Execute search
        results = engine.search(
            query=request.query,
            document_id=request.document_id,
            top_k=request.top_k,
        )

        # Convert to response model
        search_results = [
            SearchResultItem(
                tree_id=r.tree_id,
                content=r.content,
                score=r.score,
                context=r.context,
                page_number=r.page_number,
            )
            for r in results
        ]

        return SearchResponse(
            query=request.query,
            document_id=request.document_id,
            results=search_results,
            total=len(search_results),
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        )
    finally:
        conn.close()
