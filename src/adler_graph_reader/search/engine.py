"""
Hybrid search engine combining BM25, vector search, and LLM reranking.
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
    Hybrid search combining BM25, vector search, RRF fusion, and LLM reranking.
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
        4. LLM reranking
        5. Context expansion
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

        # Get top 20 for reranking
        top_20_ids = [r["tree_id"] for r in fused[:20]]
        if not top_20_ids:
            return []

        # Get full content for reranking
        chunks = database.get_chunks_by_ids(self.conn, top_20_ids)
        chunk_map = {c["tree_id"]: c for c in chunks}

        # 4: LLM reranking
        reranked = self._rerank(query, chunks)

        # 5: Context expansion and build results
        results = []
        for item in reranked[:top_k]:
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
                score=item.get("rerank_score", 0),
                context=context,
                page_number=chunk.get("page_number"),
            ))

        return results

    def _rerank(
        self,
        query: str,
        chunks: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Use LLM to rerank chunks by relevance."""
        if len(chunks) <= 5:
            return [{"tree_id": c["tree_id"], "rerank_score": 1.0} for c in chunks]

        # Build reranking prompt
        chunk_texts = "\n\n".join([
            f"[{i+1}] {c['content'][:500]}"
            for i, c in enumerate(chunks)
        ])

        prompt = f"""请根据查询 "{query}" 对以下文本片段进行相关性打分。

{chunk_texts}

请按相关性从高到低排序，输出格式：
每行一个序号，用逗号分隔，例如：1, 3, 2, 4, 5

只输出数字序号，不要有其他内容。"""

        try:
            response = self.llm_client.generate(prompt, temperature=0.3)
            # Parse response
            order = [int(x.strip()) for x in response.split(",") if x.strip().isdigit()]

            if len(order) != len(chunks):
                # Fallback: return original order
                return [{"tree_id": c["tree_id"], "rerank_score": 1.0 / (i + 1)}
                        for i, c in enumerate(chunks)]

            # Map original indices
            result = []
            for rank, idx in enumerate(order):
                if 0 < idx <= len(chunks):
                    result.append({
                        "tree_id": chunks[idx - 1]["tree_id"],
                        "rerank_score": 1.0 / (rank + 1),
                    })
            return result

        except Exception:
            # Fallback on error
            return [{"tree_id": c["tree_id"], "rerank_score": 1.0 / (i + 1)}
                    for i, c in enumerate(chunks)]
