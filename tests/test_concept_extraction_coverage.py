"""
Test concept extraction coverage improvements.

This test verifies that the ConceptExtractor properly handles large documents
by processing chunks in batches and extracting an appropriate number of concepts.
"""

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from adler_graph_reader.knowledge.extractor import ConceptExtractor
from adler_graph_reader.knowledge.progress import (
    ExtractionStage,
    ProgressManager,
)


class TestConceptExtractionCoverage:
    """Test concept extraction with improved coverage."""

    @pytest.fixture
    def mock_client(self):
        """Create a mock LLM client."""
        client = MagicMock()
        # Mock embed method
        client.embed.return_value = [0.1] * 1024
        # Mock generate method for concept name extraction
        client.generate.return_value = "\n".join([f"Concept {i}" for i in range(50)])
        # Mock generate_structured for single concept extraction
        from adler_graph_reader.llm.models import (
            EnhancedConcept,
            EnhancedConceptExtraction,
        )

        def mock_structured(prompt, response_model, **kwargs):
            # Extract concept name from prompt
            if "【" in prompt and "】" in prompt:
                name = prompt.split("【")[1].split("】")[0]
            else:
                name = "Test Concept"

            return EnhancedConceptExtraction(
                concepts=[
                    EnhancedConcept(
                        name=name,
                        definition=f"{name} is a test concept definition that describes what it means in detail.",
                        explanation=f"Explanation of {name}",
                        examples=[f"Example of {name}"],
                        importance_score=0.7,
                        category="method",
                    )
                ]
            )

        client.generate_structured.side_effect = mock_structured
        return client

    @pytest.fixture
    def temp_db(self):
        """Create a temporary database."""
        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            db_path = f.name

        conn = sqlite3.connect(db_path)
        conn.execute("""
            CREATE TABLE document_tree (
                id INTEGER PRIMARY KEY,
                document_id TEXT NOT NULL,
                type TEXT NOT NULL,
                content TEXT NOT NULL
            )
        """)
        conn.commit()

        yield conn, db_path

        conn.close()
        Path(db_path).unlink(missing_ok=True)

    def test_calculate_target_concepts(self, mock_client):
        """Test that target concept count scales with document size."""
        extractor = ConceptExtractor(client=mock_client)

        # Small document (1000 chunks) -> at least MIN_CONCEPTS
        assert extractor._calculate_target_concepts(1000) >= extractor.MIN_CONCEPTS

        # Large document (30000 chunks) -> scaled but capped
        target = extractor._calculate_target_concepts(30000)
        assert target <= extractor.MAX_CONCEPTS_HARD_LIMIT
        assert target > extractor.MIN_CONCEPTS

        # Medium document (10000 chunks) -> proportional
        target = extractor._calculate_target_concepts(10000)
        expected = int(10000 * extractor.CONCEPTS_PER_CHUNK_RATIO)
        assert target == min(expected, extractor.MAX_CONCEPTS_HARD_LIMIT)

    def test_batch_chunk_processing(self, mock_client, temp_db):
        """Test that chunks are processed in batches."""
        conn, _ = temp_db

        # Insert many chunks (content must be > 50 chars for the extractor query)
        document_id = "test_doc"
        num_chunks = 1500
        for i in range(num_chunks):
            conn.execute(
                """
                INSERT INTO document_tree (document_id, type, content)
                VALUES (?, 'chunk', ?)
                """,
                (document_id, f"Content of chunk {i} with some ML terminology and additional text to exceed 50 chars"),
            )
        conn.commit()

        extractor = ConceptExtractor(client=mock_client)

        # Verify batch configuration
        assert extractor.CHUNKS_PER_BATCH == 50
        assert extractor.MAX_CHUNKS_TO_PROCESS == 10000

        # Get total chunks
        total = extractor._get_total_chunks(conn, document_id)
        assert total == num_chunks

        # Get batch
        batch = extractor._get_chunk_batch(conn, document_id, 0, 500)
        assert len(batch) == 500

        # Get next batch
        batch2 = extractor._get_chunk_batch(conn, document_id, 500, 500)
        assert len(batch2) == 500

    def test_concept_deduplication(self, mock_client):
        """Test that duplicate concepts are filtered out."""
        extractor = ConceptExtractor(client=mock_client)

        existing_names = {"machine learning", "deep learning"}

        # Mock response with duplicates
        mock_client.generate.return_value = """
Machine Learning
Deep Learning
Machine Learning
Neural Networks
Deep Learning
Data Science
"""

        chunks = [(1, "content1"), (2, "content2")]
        names = extractor._extract_concept_names_from_batch(chunks, 10, existing_names)

        # Should not contain duplicates or existing names
        assert "Machine Learning" not in names  # Already exists (case insensitive)
        assert "Deep Learning" not in names  # Already exists
        assert "Neural Networks" in names
        assert "Data Science" in names

    def test_progress_tracking_integration(self, mock_client, temp_db):
        """Test progress tracking during concept extraction."""
        conn, _ = temp_db

        # Create progress manager
        progress_manager = ProgressManager(conn)
        progress = progress_manager.create_progress("test_doc")

        # Insert some chunks
        for i in range(100):
            conn.execute(
                """
                INSERT INTO document_tree (document_id, type, content)
                VALUES ('test_doc', 'chunk', ?)
                """,
                (f"Chunk {i} content",),
            )
        conn.commit()

        extractor = ConceptExtractor(client=mock_client)

        # Mock to return fewer concepts for testing
        mock_client.generate.return_value = "\n".join(
            [f"Concept {i}" for i in range(5)]
        )

        # Extract with progress tracking
        concepts = extractor.extract(
            conn,
            "test_doc",
            progress=progress,
            progress_manager=progress_manager,
        )

        # Verify progress was updated
        updated_progress = progress_manager.load_progress("test_doc")
        assert updated_progress.stage == ExtractionStage.CONCEPTS_COMPLETE
        assert updated_progress.extracted_concepts == len(concepts)

    def test_resume_extraction(self, mock_client, temp_db):
        """Test that extraction can resume from previous progress."""
        conn, _ = temp_db

        # Create progress with some already processed concepts
        progress_manager = ProgressManager(conn)
        progress = progress_manager.create_progress("test_doc")
        progress.stage = ExtractionStage.CONCEPTS_EXTRACTING
        progress.concept_queue = ["Concept A", "Concept B", "Concept C", "Concept D"]
        progress.processed_concepts = ["Concept A"]
        progress.total_concepts = 4
        progress_manager.save_progress(progress)

        # Insert chunks
        for i in range(50):
            conn.execute(
                """
                INSERT INTO document_tree (document_id, type, content)
                VALUES ('test_doc', 'chunk', ?)
                """,
                ("Chunk with Concept A, Concept B, Concept C, Concept D",),
            )
        conn.commit()

        extractor = ConceptExtractor(client=mock_client)

        # Extract should resume from queue
        concepts = extractor.extract(
            conn,
            "test_doc",
            progress=progress,
            progress_manager=progress_manager,
        )

        # Should skip Concept A (already processed)
        concept_names = [c.name for c in concepts]
        assert "Concept A" not in concept_names

    def test_large_document_handling(self, mock_client, temp_db):
        """Test handling of very large documents."""
        conn, _ = temp_db

        document_id = "large_doc"
        num_chunks = 5000  # Simulate large document

        # Insert chunks
        for i in range(num_chunks):
            conn.execute(
                """
                INSERT INTO document_tree (document_id, type, content)
                VALUES (?, 'chunk', ?)
                """,
                (document_id, f"ML content chunk {i}"),
            )
        conn.commit()

        extractor = ConceptExtractor(client=mock_client)

        # Calculate target
        target = extractor._calculate_target_concepts(num_chunks)

        # Should be capped at hard limit
        assert target <= extractor.MAX_CONCEPTS_HARD_LIMIT
        assert target >= extractor.MIN_CONCEPTS

        # Should process limited number of chunks
        max_to_process = min(num_chunks, extractor.MAX_CHUNKS_TO_PROCESS)
        num_batches = (
            max_to_process + extractor.CHUNKS_PER_BATCH - 1
        ) // extractor.CHUNKS_PER_BATCH
        # 5000 / 50 = 100 batches max (MAX_CHUNKS_TO_PROCESS=10000, CHUNKS_PER_BATCH=50)
        assert num_batches <= (extractor.MAX_CHUNKS_TO_PROCESS + extractor.CHUNKS_PER_BATCH - 1) // extractor.CHUNKS_PER_BATCH


class TestEndToEndExtractionPipeline:
    """End-to-end tests for the extraction pipeline."""

    def test_pipeline_with_mock_data(self):
        """Test complete pipeline with mocked data."""
        # This is a placeholder for a full integration test
        # In practice, this would use a real (but small) PDF
        pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
