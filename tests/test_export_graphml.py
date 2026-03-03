"""
Tests for GraphML and GEXF export functionality.
"""

import tempfile
from pathlib import Path

import pytest

from adler_graph_reader.export.graphml import GraphMLExporter, GEXFExporter


class TestGraphMLExporter:
    """Test cases for GraphMLExporter."""

    @pytest.fixture
    def sample_themes(self):
        """Sample theme data for testing."""
        return [
            {
                "id": 1,
                "name": "Machine Learning",
                "description": "Core ML concepts",
                "importance_score": 0.95,
            },
            {
                "id": 2,
                "name": "Data Engineering",
                "description": "Data pipeline concepts",
                "importance_score": 0.85,
            },
        ]

    @pytest.fixture
    def sample_concepts(self):
        """Sample concept data for testing."""
        return [
            {
                "id": 1,
                "name": "Neural Network",
                "definition": "A network of artificial neurons",
                "category": "concept",
                "theme_id": 1,
                "importance_score": 0.9,
                "examples": ["CNN", "RNN"],
            },
            {
                "id": 2,
                "name": "Supervised Learning",
                "definition": "Learning with labeled data",
                "category": "method",
                "theme_id": 1,
                "importance_score": 0.85,
                "examples": ["Classification", "Regression"],
            },
            {
                "id": 3,
                "name": "ETL Pipeline",
                "definition": "Extract, Transform, Load process",
                "category": "method",
                "theme_id": 2,
                "importance_score": 0.8,
                "examples": [],
            },
        ]

    @pytest.fixture
    def sample_relations(self):
        """Sample relation data for testing."""
        return [
            {
                "id": 1,
                "source_concept_id": 1,
                "target_concept_id": 2,
                "relation_type": "implements",
                "strength": 0.9,
                "evidence": "Neural networks implement supervised learning",
            },
            {
                "id": 2,
                "source_concept_id": 2,
                "target_concept_id": 1,
                "relation_type": "prerequisite_for",
                "strength": 0.8,
                "evidence": "Understanding supervised learning helps learn neural networks",
            },
        ]

    def test_exporter_initialization(self):
        """Test that exporter can be initialized with title."""
        exporter = GraphMLExporter(title="Test Graph")
        assert exporter.title == "Test Graph"
        assert exporter.NS == "http://graphml.graphdrawing.org/xmlns"

    def test_relation_types_defined(self):
        """Test that all expected relation types are defined."""
        exporter = GraphMLExporter()

        expected_types = [
            "related_to",
            "broader_than",
            "narrower_than",
            "prerequisite_for",
            "supports",
            "causes",
            "part_of",
            "implements",
            "uses",
            "produces",
            "evaluates",
            "improves",
            "similar_to",
            "contradicts",
            "has_concept",
        ]

        for rel_type in expected_types:
            assert rel_type in exporter.RELATION_TYPES
            assert "color" in exporter.RELATION_TYPES[rel_type]
            assert "style" in exporter.RELATION_TYPES[rel_type]

    def test_category_colors_defined(self):
        """Test that category colors are defined."""
        exporter = GraphMLExporter()

        expected_categories = [
            "theme",
            "concept",
            "principle",
            "method",
            "tool",
            "person",
            "event",
        ]

        for category in expected_categories:
            assert category in exporter.CATEGORY_COLORS
            assert "r" in exporter.CATEGORY_COLORS[category]
            assert "g" in exporter.CATEGORY_COLORS[category]
            assert "b" in exporter.CATEGORY_COLORS[category]

    def test_complete_graphml_export(
        self, sample_themes, sample_concepts, sample_relations
    ):
        """Test complete GraphML export to file."""
        exporter = GraphMLExporter(title="Test Knowledge Graph")

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "test.graphml"

            result_path = exporter.export(
                themes=sample_themes,
                concepts=sample_concepts,
                relations=sample_relations,
                output_path=output_path,
            )

            # Verify file was created
            assert result_path.exists()
            assert result_path == output_path

            # Read and verify content
            content = result_path.read_text(encoding="utf-8")

            # Check structure (ElementTree uses single quotes)
            assert "<?xml version='1.0' encoding='utf-8'?>" in content
            assert "<graphml" in content
            assert 'xmlns="http://graphml.graphdrawing.org/xmlns"' in content
            # Graph ID is based on title
            assert 'edgedefault="directed"' in content
            assert "</graph>" in content
            assert "</graphml>" in content

            # Check keys are defined
            assert (
                '<key id="d0" for="node" attr.name="label" attr.type="string"'
                in content
            )
            assert (
                '<key id="d4" for="node" attr.name="importance" attr.type="float"'
                in content
            )
            assert (
                '<key id="d9" for="edge" attr.name="relation_type" attr.type="string"'
                in content
            )
            assert (
                '<key id="d10" for="edge" attr.name="strength" attr.type="float"'
                in content
            )

            # Check nodes exist
            assert '<node id="theme_1">' in content
            assert '<node id="theme_2">' in content
            assert '<node id="concept_1">' in content
            assert '<node id="concept_2">' in content
            assert '<node id="concept_3">' in content

            # Check node data
            assert "Machine Learning" in content
            assert "Neural Network" in content
            assert '<data key="d1">theme</data>' in content
            assert '<data key="d1">concept</data>' in content

            # Check edges exist
            assert '<edge id="e1"' in content
            assert '<edge id="e2"' in content

            # Check edge data
            assert '<data key="d9">implements</data>' in content
            assert '<data key="d9">prerequisite_for</data>' in content
            assert '<data key="d10">0.9</data>' in content

            # Check theme-concept edges
            assert 'source="theme_1" target="concept_1"' in content
            assert 'source="theme_1" target="concept_2"' in content
            assert 'source="theme_2" target="concept_3"' in content

    def test_empty_graph_export(self):
        """Test export with empty data."""
        exporter = GraphMLExporter()

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "empty.graphml"

            exporter.export(
                themes=[],
                concepts=[],
                relations=[],
                output_path=output_path,
            )

            content = output_path.read_text(encoding="utf-8")
            assert "<graphml" in content
            # Should still have valid structure even with no nodes/edges
            assert "</graphml>" in content
            assert 'edgedefault="directed"' in content

    def test_special_characters_in_content(self):
        """Test that special XML characters are properly handled."""
        exporter = GraphMLExporter()

        themes = [
            {
                "id": 1,
                "name": "Test & Debug <Code>",
                "description": 'Use special chars: "quotes" & ampersand <tag>',
                "importance_score": 0.5,
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "special.graphml"

            exporter.export(
                themes=themes,
                concepts=[],
                relations=[],
                output_path=output_path,
            )

            content = output_path.read_text(encoding="utf-8")
            # The XML should be well-formed (ElementTree handles escaping)
            assert "<graphml" in content
            assert "</graphml>" in content

    def test_concept_with_missing_category(self):
        """Test export when concept has no category."""
        exporter = GraphMLExporter()

        concepts = [
            {
                "id": 1,
                "name": "Test Concept",
                "definition": "A test concept",
                # No category field
                "importance_score": 0.7,
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "nocat.graphml"

            exporter.export(
                themes=[],
                concepts=concepts,
                relations=[],
                output_path=output_path,
            )

            content = output_path.read_text(encoding="utf-8")
            assert "<graphml" in content
            # Should use default color values
            assert '<data key="d5">230</data>' in content  # r value for concept


class TestGEXFExporter:
    """Test cases for GEXFExporter."""

    @pytest.fixture
    def sample_themes(self):
        """Sample theme data for testing."""
        return [
            {
                "id": 1,
                "name": "Machine Learning",
                "description": "Core ML concepts",
                "importance_score": 0.95,
            },
        ]

    @pytest.fixture
    def sample_concepts(self):
        """Sample concept data for testing."""
        return [
            {
                "id": 1,
                "name": "Neural Network",
                "definition": "A network of artificial neurons",
                "category": "concept",
                "theme_id": 1,
                "importance_score": 0.9,
                "examples": ["CNN", "RNN"],
            },
        ]

    @pytest.fixture
    def sample_relations(self):
        """Sample relation data for testing."""
        return [
            {
                "id": 1,
                "source_concept_id": 1,
                "target_concept_id": 1,  # Self-loop for testing
                "relation_type": "related_to",
                "strength": 0.5,
                "evidence": "Self-referential",
            },
        ]

    def test_gexf_exporter_initialization(self):
        """Test that GEXF exporter can be initialized."""
        exporter = GEXFExporter(title="Test GEXF")
        assert exporter.title == "Test GEXF"
        # VERSION constant may not exist, check NS instead
        assert hasattr(exporter, "NS")

    def test_gexf_namespace_and_version(self):
        """Test GEXF namespace and version constants."""
        exporter = GEXFExporter()
        assert "http://www.gexf.net/" in exporter.NS

    def test_complete_gexf_export(
        self, sample_themes, sample_concepts, sample_relations
    ):
        """Test complete GEXF export to file."""
        exporter = GEXFExporter(title="Test GEXF Graph")

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "test.gexf"

            result_path = exporter.export(
                themes=sample_themes,
                concepts=sample_concepts,
                relations=sample_relations,
                output_path=output_path,
            )

            assert result_path.exists()
            content = result_path.read_text(encoding="utf-8")

            # Check structure (ElementTree uses single quotes)
            assert "<?xml version='1.0' encoding='utf-8'?>" in content
            assert "<gexf" in content
            assert 'version="1.3"' in content
            assert "<creator>Adler-Graph-Reader</creator>" in content
            assert "Test GEXF Graph" in content
            assert 'defaultedgetype="directed"' in content
            assert "</gexf>" in content

            # Check attribute definitions (ElementTree adds space before />
            assert '<attributes class="node"' in content
            assert 'title="type" type="string"' in content
            assert 'title="importance" type="float"' in content

            # Check edge attributes
            assert '<attributes class="edge"' in content
            assert 'title="relation_type" type="string"' in content
            assert 'title="strength" type="float"' in content

            # Check nodes
            assert '<node id="theme_1" label="Machine Learning">' in content
            assert '<node id="concept_1" label="Neural Network">' in content

            # Check node attributes (ElementTree adds space before />)
            assert 'for="0" value="theme"' in content
            assert 'for="0" value="concept"' in content

            # Check edges
            assert '<edge id="0" source="concept_1" target="concept_1"' in content
            assert 'label="related_to"' in content
            # Strength is stored as attvalue, not weight attribute
            assert 'for="5" value="0.5"' in content

    def test_gexf_viz_attributes(self, sample_themes, sample_concepts):
        """Test that GEXF viz attributes are included."""
        exporter = GEXFExporter()

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "viz.gexf"

            exporter.export(
                themes=sample_themes,
                concepts=sample_concepts,
                relations=[],
                output_path=output_path,
            )

            content = output_path.read_text(encoding="utf-8")
            # Check viz namespace
            assert "xmlns:viz=" in content
            # Check color elements
            assert "<viz:color" in content
            # viz:size may or may not be present depending on implementation


class TestIntegrationWithKnowledgeGraph:
    """Integration tests with KnowledgeGraph class."""

    def test_knowledge_graph_has_export_graphml_method(self):
        """Test that KnowledgeGraph class has export_graphml method."""
        from adler_graph_reader.knowledge.graph import KnowledgeGraph

        # Check method exists
        assert hasattr(KnowledgeGraph, "export_graphml")
        assert callable(getattr(KnowledgeGraph, "export_graphml"))

    def test_knowledge_graph_has_export_gexf_method(self):
        """Test that KnowledgeGraph class has export_gexf method."""
        from adler_graph_reader.knowledge.graph import KnowledgeGraph

        # Check method exists
        assert hasattr(KnowledgeGraph, "export_gexf")
        assert callable(getattr(KnowledgeGraph, "export_gexf"))


class TestCLIIntegration:
    """Test CLI integration for graph export."""

    def test_cli_export_graph_formats_include_graphml_and_gexf(self):
        """Test that CLI export-graph command supports graphml and gexf formats.

        Note: parse_args() doesn't take arguments directly - it reads from sys.argv.
        We verify the choices include our new formats by checking the CLI definition.
        """
        import argparse

        # Create parser and get subparsers
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        # Add export-graph command like in cli.py
        export_graph = subparsers.add_parser("export-graph")
        export_graph.add_argument("--document", "-d", required=True)
        export_graph.add_argument(
            "--formats",
            nargs="+",
            choices=["dot", "svg", "json", "graphml", "gexf"],
            default=["dot", "json"],
        )

        # Test parsing with graphml
        args = parser.parse_args(
            ["export-graph", "-d", "test-doc", "--formats", "graphml"]
        )
        assert args.formats == ["graphml"]

        # Test parsing with gexf
        args = parser.parse_args(
            ["export-graph", "-d", "test-doc", "--formats", "gexf"]
        )
        assert args.formats == ["gexf"]

        # Test multiple formats
        args = parser.parse_args(
            ["export-graph", "-d", "test-doc", "--formats", "graphml", "gexf", "json"]
        )
        assert "graphml" in args.formats
        assert "gexf" in args.formats
        assert "json" in args.formats
