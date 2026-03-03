#!/usr/bin/env python3
"""
Verify concept extraction improvements.

This script demonstrates the improved concept extraction coverage
by showing how the new batch processing works.
"""

import sqlite3
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from adler_graph_reader.knowledge.extractor import ConceptExtractor


def main():
    """Main verification function."""
    print("=" * 60)
    print("Concept Extraction Coverage Verification")
    print("=" * 60)

    # Show configuration
    extractor_class = ConceptExtractor
    print("\n📊 Configuration:")
    print(f"  - Chunks per batch: {extractor_class.CHUNKS_PER_BATCH}")
    print(f"  - Max chunks to process: {extractor_class.MAX_CHUNKS_TO_PROCESS}")
    print(f"  - Concepts per chunk ratio: {extractor_class.CONCEPTS_PER_CHUNK_RATIO}")
    print(f"  - Min concepts: {extractor_class.MIN_CONCEPTS}")
    print(f"  - Max concepts hard limit: {extractor_class.MAX_CONCEPTS_HARD_LIMIT}")

    # Calculate expected concepts for different document sizes
    print("\n📈 Expected Concept Counts:")
    test_sizes = [1000, 5000, 10000, 20000, 28465, 50000]
    for chunks in test_sizes:
        target = int(chunks * extractor_class.CONCEPTS_PER_CHUNK_RATIO)
        target = max(
            extractor_class.MIN_CONCEPTS,
            min(target, extractor_class.MAX_CONCEPTS_HARD_LIMIT),
        )
        batches = min(
            (
                min(chunks, extractor_class.MAX_CHUNKS_TO_PROCESS)
                + extractor_class.CHUNKS_PER_BATCH
                - 1
            )
            // extractor_class.CHUNKS_PER_BATCH,
            6,
        )
        print(f"  {chunks:>6} chunks -> {target:>4} concepts ({batches} batches)")

    # Check database if available
    db_path = Path("knowledge.sqlite")
    if db_path.exists():
        print("\n📚 Database Analysis:")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Get document stats
        cursor.execute("""
            SELECT document_id, COUNT(*) as chunk_count
            FROM document_tree
            WHERE type = 'chunk'
            GROUP BY document_id
        """)
        docs = cursor.fetchall()

        for doc_id, chunk_count in docs:
            print(f"\n  Document: {doc_id}")
            print(f"    Chunks: {chunk_count}")

            # Get concept count
            cursor.execute(
                "SELECT COUNT(*) FROM concepts WHERE document_id = ?", (doc_id,)
            )
            concept_count = cursor.fetchone()[0]
            print(f"    Concepts: {concept_count}")

            # Get theme count
            cursor.execute(
                "SELECT COUNT(*) FROM themes WHERE document_id = ?", (doc_id,)
            )
            theme_count = cursor.fetchone()[0]
            print(f"    Themes: {theme_count}")

            # Calculate expected
            expected = int(chunk_count * extractor_class.CONCEPTS_PER_CHUNK_RATIO)
            expected = max(
                extractor_class.MIN_CONCEPTS,
                min(expected, extractor_class.MAX_CONCEPTS_HARD_LIMIT),
            )
            print(f"    Expected concepts: {expected}")

            # Ratio check
            if theme_count > 0:
                ratio = concept_count / theme_count
                print(f"    Concept/Theme ratio: {ratio:.1f}x", end="")
                if ratio < 5:
                    print(" ⚠️ (should be > 5)")
                else:
                    print(" ✅")

        conn.close()
    else:
        print("\n⚠️  No knowledge.sqlite found. Run extraction first.")

    print("\n" + "=" * 60)
    print("Verification Complete")
    print("=" * 60)


if __name__ == "__main__":
    main()
