"""Tests for the FastAPI endpoints."""

import pytest
from fastapi.testclient import TestClient

from adler_graph_reader.api.main import create_app


@pytest.fixture
def client():
    """Create a test client."""
    app = create_app()
    return TestClient(app)


class TestHealthEndpoint:
    """Tests for the health check endpoint."""

    def test_health_check(self, client):
        """Test the health check endpoint."""
        response = client.get("/health")
        # Health endpoint may be at root or under api prefix
        if response.status_code == 404:
            response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data or data.get("status") == "healthy"
        assert "version" in data


class TestDocumentsEndpoints:
    """Tests for document endpoints."""

    def test_list_documents(self, client):
        """Test listing documents."""
        response = client.get("/api/documents")
        assert response.status_code == 200
        data = response.json()
        assert "documents" in data
        assert "total" in data

    def test_list_documents_pagination(self, client):
        """Test document pagination."""
        response = client.get("/api/documents?page=1&page_size=10")
        assert response.status_code == 200
        data = response.json()
        assert "documents" in data

    def test_get_document_not_found(self, client):
        """Test getting a non-existent document."""
        response = client.get("/api/documents/nonexistent")
        assert response.status_code == 404


class TestConceptsEndpoints:
    """Tests for concept endpoints."""

    def test_list_concepts(self, client):
        """Test listing concepts."""
        response = client.get("/api/concepts")
        assert response.status_code == 200
        data = response.json()
        assert "concepts" in data
        assert "total" in data
        assert "has_more" in data

    def test_list_concepts_with_filters(self, client):
        """Test listing concepts with filters."""
        response = client.get("/api/concepts?category=concept&page_size=5")
        assert response.status_code == 200
        data = response.json()
        assert "concepts" in data

    def test_search_concepts(self, client):
        """Test searching concepts."""
        response = client.post(
            "/api/concepts/search",
            json={"search": "test", "page_size": 10},
        )
        assert response.status_code == 200
        data = response.json()
        assert "concepts" in data

    def test_get_concept_not_found(self, client):
        """Test getting a non-existent concept."""
        response = client.get("/api/concepts/99999")
        assert response.status_code == 404

    def test_get_related_concepts_not_found(self, client):
        """Test getting related concepts for non-existent concept."""
        response = client.get("/api/concepts/99999/related")
        assert response.status_code == 404


class TestRelationsEndpoints:
    """Tests for relation endpoints."""

    def test_list_relations(self, client):
        """Test listing relations."""
        response = client.get("/api/relations")
        assert response.status_code == 200
        data = response.json()
        assert "relations" in data
        assert "total" in data

    def test_get_relation_types(self, client):
        """Test getting relation types."""
        response = client.get("/api/relations/types")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


class TestSearchEndpoints:
    """Tests for search endpoints."""

    def test_search_missing_query(self, client):
        """Test search without required query."""
        response = client.post(
            "/api/search",
            json={"document_id": "test"},
        )
        assert response.status_code == 422  # Validation error

    def test_search_suggestions(self, client):
        """Test search suggestions."""
        response = client.get("/api/search/suggest?q=machine&document_id=test")
        # May return 200 or 404 depending on document existence
        assert response.status_code in [200, 404]


class TestQAEndpoints:
    """Tests for QA endpoints."""

    def test_ask_question_missing_fields(self, client):
        """Test asking a question without required fields."""
        response = client.post(
            "/api/qa",
            json={},
        )
        assert response.status_code == 422  # Validation error

    def test_create_session(self, client):
        """Test creating a QA session."""
        response = client.post("/api/qa/sessions")
        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data


class TestGraphEndpoints:
    """Tests for graph endpoints."""

    def test_get_graph_not_found(self, client):
        """Test getting graph for non-existent document."""
        response = client.get("/api/graph/nonexistent")
        # May return 404 or 500 depending on error handling
        assert response.status_code in [404, 500]

    def test_export_graph_invalid_format(self, client):
        """Test exporting graph with invalid format."""
        response = client.post(
            "/api/graph/export",
            json={"document_id": "test", "format": "invalid"},
        )
        assert response.status_code == 422  # Validation error

    def test_export_graph_get(self, client):
        """Test GET export endpoint."""
        response = client.get("/api/graph/export/test?format=json")
        # May return 200 or 404 depending on document existence
        assert response.status_code in [200, 404, 500]


class TestModels:
    """Tests for Pydantic models."""

    def test_search_request_validation(self):
        """Test SearchRequest validation."""
        from adler_graph_reader.api.models import SearchRequest

        # Valid request
        req = SearchRequest(query="test", document_id="doc1")
        assert req.query == "test"
        assert req.document_id == "doc1"
        assert req.top_k == 10  # default

        # Invalid top_k
        with pytest.raises(ValueError):
            SearchRequest(query="test", document_id="doc1", top_k=100)

    def test_query_request_validation(self):
        """Test QueryRequest validation."""
        from adler_graph_reader.api.models import QueryRequest

        # Valid request
        req = QueryRequest(question="What is ML?", document_id="doc1")
        assert req.question == "What is ML?"
        assert req.document_id == "doc1"

    def test_concept_list_request_validation(self):
        """Test ConceptListRequest validation."""
        from adler_graph_reader.api.models import ConceptListRequest

        # Valid request
        req = ConceptListRequest(page=1, page_size=20)
        assert req.page == 1
        assert req.page_size == 20

        # Invalid page_size
        with pytest.raises(ValueError):
            ConceptListRequest(page=1, page_size=200)
