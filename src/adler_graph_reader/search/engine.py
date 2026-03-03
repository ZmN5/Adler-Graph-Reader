"""
Hybrid search engine combining BM25 and vector search with RRF fusion and optional reranking.
"""

import logging
from dataclasses import dataclass
from typing import Any, Optional

from .. import database
from ..llm import get_default_client
from .fusion import rrf_fusion

logger = logging.getLogger(__name__)


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
    Hybrid search combining BM25, vector search, RRF fusion, and optional LLM reranking.
    """

    def __init__(
        self,
        conn: Optional[Any] = None,
        llm_client: Optional[Any] = None,
        use_reranker: bool = True,
        reranker_model: str = "qwen3-reranker-0.6b",
    ):
        self.conn = conn or database.get_connection()
        self.llm_client = llm_client or get_default_client()
        self.use_reranker = use_reranker
        self.reranker_model = reranker_model

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
        4. Context expansion
        5. Optional: LLM reranking
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

        # Get top results with scores (get more for reranking if enabled)
        initial_k = top_k * 3 if self.use_reranker else top_k
        top_results = fused[:initial_k]
        if not top_results:
            return []

        top_ids = [r["tree_id"] for r in top_results]

        # Create score map from fusion results
        score_map = {r["tree_id"]: r.get("rrf_score", 0) for r in top_results}

        # Get full content
        chunks = database.get_chunks_by_ids(self.conn, top_ids)
        chunk_map = {c["tree_id"]: c for c in chunks}

        # 4: Context expansion and build initial results
        candidates = []
        for item in top_results:
            tree_id = item["tree_id"]
            chunk = chunk_map.get(tree_id)
            if not chunk:
                continue

            # Get sibling context
            siblings = database.get_sibling_chunks(self.conn, tree_id, limit=2)
            context = [s["content"] for s in siblings]

            candidates.append(
                SearchResult(
                    tree_id=tree_id,
                    content=chunk["content"],
                    score=score_map.get(tree_id, 0),
                    context=context,
                    page_number=chunk.get("page_number"),
                )
            )

        # 5: Optional reranking
        if self.use_reranker and len(candidates) > 1:
            candidates = self._rerank(query, candidates)

        return candidates[:top_k]

    def _rerank(
        self,
        query: str,
        candidates: list[SearchResult],
    ) -> list[SearchResult]:
        """
        Rerank candidates using the reranker model.

        Uses LM Studio's reranker API to score query-document pairs.
        """
        try:
            # Prepare pairs for reranking
            pairs = []
            for cand in candidates:
                # Combine content with context for reranking
                full_text = cand.content
                if cand.context:
                    full_text += "\n" + "\n".join(cand.context[:2])
                pairs.append((query, full_text))

            # Call reranker API via OpenAI SDK
            scores = self._call_reranker(pairs)

            # Update scores and sort
            for i, cand in enumerate(candidates):
                if i < len(scores):
                    # Blend RRF score with reranker score
                    rrf_score = cand.score
                    rerank_score = scores[i]
                    # Weighted combination: 30% RRF, 70% reranker
                    cand.score = 0.3 * rrf_score + 0.7 * rerank_score

            # Sort by new score
            candidates.sort(key=lambda x: x.score, reverse=True)

        except Exception as e:
            # If reranking fails, return original order
            logger.warning("Reranking failed: %s", e, exc_info=True)

        return candidates

    def _call_reranker(self, pairs: list[tuple[str, str]]) -> list[float]:
        """
        Call the reranker model to score query-document pairs.

        Uses the reranker model via OpenAI-compatible API.
        Falls back to embedding similarity if reranker is not available.
        """
        try:
            # Try to use the reranker via OpenAI SDK
            # Note: LM Studio may support reranker via /v1/rerank endpoint
            # For now, we use a simple embedding-based similarity as fallback

            import httpx

            # Try LM Studio's rerank endpoint
            response = httpx.post(
                f"{self.llm_client.base_url}/rerank",
                json={
                    "model": self.reranker_model,
                    "query": pairs[0][0],  # All pairs have same query
                    "documents": [p[1] for p in pairs],
                },
                timeout=30.0,
            )

            if response.status_code == 200:
                result = response.json()
                # Extract scores from response
                scores = [0.0] * len(pairs)
                for item in result.get("results", []):
                    idx = item.get("index", 0)
                    score = item.get("relevance_score", 0.0)
                    if 0 <= idx < len(scores):
                        scores[idx] = score
                return scores

        except Exception:
            pass

        # Fallback: Use embedding similarity
        return self._embedding_similarity_rerank(pairs)

    def _embedding_similarity_rerank(
        self,
        pairs: list[tuple[str, str]],
    ) -> list[float]:
        """
        Fallback reranking using embedding cosine similarity.
        """
        scores = []
        query = pairs[0][0]

        try:
            query_embedding = self.llm_client.embed(query)

            for _, doc_text in pairs:
                doc_embedding = self.llm_client.embed(
                    doc_text[:500]
                )  # Truncate for speed
                # Cosine similarity
                import math

                dot = sum(a * b for a, b in zip(query_embedding, doc_embedding))
                norm_q = math.sqrt(sum(a * a for a in query_embedding))
                norm_d = math.sqrt(sum(b * b for b in doc_embedding))
                similarity = dot / (norm_q * norm_d) if norm_q > 0 and norm_d > 0 else 0
                # Normalize to 0-1 range (rough approximation)
                scores.append((similarity + 1) / 2)

        except Exception:
            # If embedding fails, return uniform scores
            scores = [0.5] * len(pairs)

        return scores
