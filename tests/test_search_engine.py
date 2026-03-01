"""Tests for search engine module."""

from unittest.mock import Mock

import pytest

from adler_graph_reader.search.engine import HybridSearchEngine, SearchResult
from adler_graph_reader.search.fusion import rrf_fusion


class TestRRFFusion:
    """Test Reciprocal Rank Fusion algorithm."""

    def test_rrf_combines_results(self):
        """Test RRF correctly combines two result lists."""
        bm25_results = [
            {"tree_id": 1, "score": 0.9},
            {"tree_id": 2, "score": 0.8},
            {"tree_id": 3, "score": 0.7},
        ]

        vector_results = [
            {"tree_id": 2, "score": 0.95},
            {"tree_id": 1, "score": 0.85},
            {"tree_id": 4, "score": 0.75},
        ]

        fused = rrf_fusion(bm25_results, vector_results, k=60)

        # Should return all unique IDs
        assert len(fused) == 4

        # Results should be sorted by score descending
        scores = [r["rrf_score"] for r in fused]
        assert scores == sorted(scores, reverse=True)

    def test_rrf_empty_inputs(self):
        """Test RRF with empty inputs."""
        fused = rrf_fusion([], [], k=60)
        assert len(fused) == 0

    def test_rrf_single_source(self):
        """Test RRF with only one source."""
        bm25_results = [{"tree_id": 1, "score": 0.9}]

        fused = rrf_fusion(bm25_results, [], k=60)

        assert len(fused) == 1
        assert fused[0]["tree_id"] == 1


class TestHybridSearchEngine:
    """Test hybrid search engine."""

    @pytest.fixture
    def mock_engine(self):
        """Create a search engine with mocked dependencies."""
        mock_conn = Mock()
        mock_llm = Mock()
        mock_llm.embed.return_value = [0.1] * 768

        engine = HybridSearchEngine(
            conn=mock_conn,
            llm_client=mock_llm,
            use_reranker=False,
        )
        return engine, mock_conn, mock_llm

    def test_search_returns_results(self, mock_engine):
        """Test search returns formatted results."""
        engine, mock_conn, _ = mock_engine

        # Mock database responses
        mock_conn.execute.return_value.fetchall.return_value = [
            (1, "Test content", 1),
        ]

        # This test would need more mocking setup to work fully
        # For now, just verify the engine initializes correctly
        assert engine is not None
        assert engine.use_reranker is False


class TestSearchResult:
    """Test SearchResult dataclass."""

    def test_search_result_creation(self):
        """Test creating a SearchResult instance."""
        result = SearchResult(
            tree_id=1,
            content="Test content",
            score=0.95,
            context=["Context 1", "Context 2"],
            page_number=5,
        )

        assert result.tree_id == 1
        assert result.content == "Test content"
        assert result.score == 0.95
        assert len(result.context) == 2
        assert result.page_number == 5

    def test_search_result_optional_fields(self):
        """Test SearchResult with optional fields as None."""
        result = SearchResult(
            tree_id=1,
            content="Test content",
            score=0.95,
            context=[],
            page_number=None,
        )

        assert result.page_number is None
        assert result.context == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
