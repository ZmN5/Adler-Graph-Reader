"""
Hybrid search engine combining BM25 and vector search with RRF fusion.
"""

from dataclasses import dataclass
from typing import Any, Optional

from .. import database
from ..llm import get_default_client
from .fusion import rrf_fusion


@dataclass
class SearchResult:
    """Represents a search result with context."""
    tree_id: int
    content: str
    score: float
    context: list[str]  # Expanded context from siblings
    page_number: Optional[int]


class HybridSearchEngine:
    """
    Hybrid search combining BM25, vector search, and RRF fusion.
    No LLM reranking - uses direct RRF scoring.
    """

    def __init__(
        self,
        conn: Optional[Any] = None,
        llm_client: Optional[Any] = None,
    ):
        self.conn = conn or database.get_connection()
        self.llm_client = llm_client or get_default_client()

    def search(
        self,
        query: str,
        document_id: str,
        top_k: int = 5,
    ) -> list[SearchResult]:
        """
        Execute hybrid search pipeline:
        1. BM25 search
        2. Vector search
        3. RRF fusion
        4. Context expansion (no LLM reranking)
        """
        # 1 & 2: Parallel BM25 and Vector search
        bm25_results = database.bm25_search(self.conn, query, document_id, limit=20)

        # Get query embedding for vector search
        query_embedding = self.llm_client.embed(query)
        vector_results = database.vector_search(
            self.conn,
            query_embedding,
            document_id,
            limit=20,
        )

        # 3: RRF fusion
        fused = rrf_fusion(bm25_results, vector_results, k=60)

        # Get top results with scores
        top_results = fused[:top_k]
        if not top_results:
            return []

        top_ids = [r["tree_id"] for r in top_results]
        
        # Create score map from fusion results
        score_map = {r["tree_id"]: r.get("rrf_score", 0) for r in top_results}

        # Get full content
        chunks = database.get_chunks_by_ids(self.conn, top_ids)
        chunk_map = {c["tree_id"]: c for c in chunks}

        # 4: Context expansion and build results
        results = []
        for item in top_results:
            tree_id = item["tree_id"]
            chunk = chunk_map.get(tree_id)
            if not chunk:
                continue

            # Get sibling context
            siblings = database.get_sibling_chunks(self.conn, tree_id, limit=2)
            context = [s["content"] for s in siblings]

            results.append(SearchResult(
                tree_id=tree_id,
                content=chunk["content"],
                score=score_map.get(tree_id, 0),
                context=context,
                page_number=chunk.get("page_number"),
            ))

        return results
