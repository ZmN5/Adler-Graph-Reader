"""Tests for knowledge extractor module."""

from unittest.mock import Mock

import pytest

from adler_graph_reader.knowledge.extractor import (
    ThemeExtractor,
    ConceptExtractor,
    RelationExtractor,
)
from adler_graph_reader.knowledge.graph_models import (
    ConceptModel,
    RelationModel,
    ThemeModel,
)


class TestThemeExtractor:
    """Test ThemeExtractor functionality."""

    @pytest.fixture
    def mock_extractor(self):
        """Create a theme extractor with mocked LLM client."""
        mock_client = Mock()
        extractor = ThemeExtractor(client=mock_client)
        return extractor, mock_client

    def test_theme_extractor_init(self, mock_extractor):
        """Test ThemeExtractor initialization."""
        extractor, _ = mock_extractor
        assert extractor is not None
        assert extractor.client is not None


class TestConceptExtractor:
    """Test ConceptExtractor functionality."""

    @pytest.fixture
    def mock_extractor(self):
        """Create a concept extractor with mocked LLM client."""
        mock_client = Mock()
        mock_client.embed.return_value = [0.1] * 768
        extractor = ConceptExtractor(client=mock_client)
        return extractor, mock_client

    def test_concept_extractor_init(self, mock_extractor):
        """Test ConceptExtractor initialization."""
        extractor, _ = mock_extractor
        assert extractor is not None
        assert extractor.client is not None


class TestRelationExtractor:
    """Test RelationExtractor functionality."""

    @pytest.fixture
    def mock_extractor(self):
        """Create a relation extractor with mocked LLM client."""
        mock_client = Mock()
        extractor = RelationExtractor(client=mock_client)
        return extractor, mock_client

    def test_relation_extractor_init(self, mock_extractor):
        """Test RelationExtractor initialization."""
        extractor, _ = mock_extractor
        assert extractor is not None
        assert extractor.client is not None

    def test_extract_empty_concepts(self, mock_extractor):
        """Test extract with empty concepts list returns empty results."""
        extractor, _ = mock_extractor

        # Create a mock connection
        mock_conn = Mock()

        # Extract with empty concepts
        relations = extractor.extract(mock_conn, "doc-1", [], max_relations=10)

        assert relations == []

    def test_extract_single_concept(self, mock_extractor):
        """Test extract with single concept returns empty (needs at least 2)."""
        extractor, _ = mock_extractor

        mock_conn = Mock()
        single_concept = [
            ConceptModel(
                document_id="doc-1",
                name="Test Concept",
                definition="A test concept",
            ),
        ]

        relations = extractor.extract(mock_conn, "doc-1", single_concept)

        assert relations == []


class TestGraphModels:
    """Test graph model dataclasses."""

    def test_concept_model_creation(self):
        """Test creating a ConceptModel instance."""
        concept = ConceptModel(
            document_id="doc-1",
            name="Machine Learning",
            definition="A method of data analysis",
            importance_score=0.9,
        )

        assert concept.document_id == "doc-1"
        assert concept.name == "Machine Learning"
        assert concept.importance_score == 0.9

    def test_theme_model_creation(self):
        """Test creating a ThemeModel instance."""
        theme = ThemeModel(
            document_id="doc-1",
            name="AI Fundamentals",
            description="Basic concepts in AI",
            importance_score=0.95,
        )

        assert theme.document_id == "doc-1"
        assert theme.name == "AI Fundamentals"
        assert theme.importance_score == 0.95

    def test_relation_model_creation(self):
        """Test creating a RelationModel instance."""
        relation = RelationModel(
            document_id="doc-1",
            source_concept_id=1,
            target_concept_id=2,
            relation_type="prerequisite_for",
            strength=0.8,
        )

        assert relation.document_id == "doc-1"
        assert relation.source_concept_id == 1
        assert relation.target_concept_id == 2
        assert relation.relation_type == "prerequisite_for"
        assert relation.strength == 0.8


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
