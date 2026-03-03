"""Tests for database module."""

import tempfile
from pathlib import Path

import pytest

from adler_graph_reader.database import (
    init_database,
    insert_chunk,
    bm25_search,
    insert_embedding,
)


@pytest.fixture
def temp_db():
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        conn = init_database(db_path)
        yield conn, db_path
        conn.close()


class TestDatabaseInitialization:
    """Test database initialization."""

    def test_init_creates_tables(self, temp_db):
        """Test that init_database creates all required tables."""
        conn, _ = temp_db
        cursor = conn.cursor()

        # Check document_tree table exists
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='document_tree'"
        )
        assert cursor.fetchone() is not None

        # Check fts_chunks virtual table exists
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='fts_chunks'"
        )
        assert cursor.fetchone() is not None

        # Check vec_chunks virtual table exists
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_chunks'"
        )
        assert cursor.fetchone() is not None


class TestChunkOperations:
    """Test chunk CRUD operations."""

    def test_insert_chunk(self, temp_db):
        """Test inserting a chunk."""
        conn, _ = temp_db

        tree_id = insert_chunk(
            conn=conn,
            document_id="test-doc-1",
            content="Test content",
            chunk_type="chapter",
            page_number=1,
        )

        assert tree_id is not None
        assert isinstance(tree_id, int)

    def test_insert_with_parent(self, temp_db):
        """Test inserting a child chunk with parent reference."""
        conn, _ = temp_db

        # Insert parent
        parent_id = insert_chunk(
            conn=conn,
            document_id="test-doc-1",
            content="Parent chapter",
            chunk_type="chapter",
        )

        # Insert child
        child_id = insert_chunk(
            conn=conn,
            document_id="test-doc-1",
            content="Child chunk",
            chunk_type="chunk",
            parent_id=parent_id,
        )

        assert child_id is not None
        assert child_id != parent_id


class TestSearchOperations:
    """Test search functionality."""

    def test_bm25_search_finds_content(self, temp_db):
        """Test BM25 search finds matching content."""
        conn, _ = temp_db

        # Insert test content
        insert_chunk(
            conn=conn,
            document_id="test-doc-1",
            content="Machine learning is a subset of artificial intelligence",
            chunk_type="chunk",
        )

        insert_chunk(
            conn=conn,
            document_id="test-doc-1",
            content="Deep learning uses neural networks",
            chunk_type="chunk",
        )

        # Search
        results = bm25_search(conn, "machine learning", "test-doc-1", limit=5)

        assert len(results) > 0
        assert any("machine" in r["content"].lower() for r in results)

    def test_bm25_search_empty_query(self, temp_db):
        """Test BM25 search with empty query returns empty results."""
        conn, _ = temp_db

        results = bm25_search(conn, "", "test-doc-1", limit=5)

        assert len(results) == 0


class TestEmbeddingOperations:
    """Test embedding storage and retrieval."""

    def test_insert_embedding(self, temp_db):
        """Test inserting an embedding vector."""
        conn, _ = temp_db

        # First insert a chunk
        tree_id = insert_chunk(
            conn=conn,
            document_id="test-doc-1",
            content="Test content",
            chunk_type="chunk",
        )

        # Insert embedding
        embedding = [0.1] * 1024  # Test embedding vector (qwen3-embedding-0.6b)
        insert_embedding(conn, tree_id, embedding)

        # Verify by querying
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM vec_chunks WHERE tree_id = ?",
            (tree_id,),
        )
        count = cursor.fetchone()[0]

        assert count == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
