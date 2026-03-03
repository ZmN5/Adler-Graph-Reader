#!/usr/bin/env python3
"""Test script to verify Chonkie integration."""

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))


def test_imports():
    """Test that all imports work correctly."""
    print("Testing imports...")
    
    from adler_graph_reader.chunking import create_chonkie_splitter, ChonkieSplitter
    from adler_graph_reader.chunking.chonkie_splitter import LMStudioEmbeddings
    
    print("✓ All imports successful")
    return True


def test_chonkie_structure():
    """Test ChonkieSplitter structure without calling LM Studio."""
    print("\nTesting ChonkieSplitter structure...")
    
    from adler_graph_reader.chunking import create_chonkie_splitter
    
    # Create splitter (doesn't call LM Studio yet due to lazy init)
    splitter = create_chonkie_splitter()
    print(f"✓ Created ChonkieSplitter with chunk_size={splitter.chunk_size}")
    
    # Verify attributes
    assert splitter.chunk_size == 400
    assert splitter.similarity_threshold == 0.7
    assert splitter.min_chunk_size == 50
    print("✓ Configuration verified")
    
    # Verify embedding model setup
    assert splitter.embedding_model.model == "qwen3-embedding"
    assert splitter.embedding_model.base_url == "http://localhost:1234/v1"
    print("✓ Embedding model configuration verified")
    
    return True


def test_lmstudio_embeddings_class():
    """Test LMStudioEmbeddings class structure."""
    print("\nTesting LMStudioEmbeddings class...")
    
    from adler_graph_reader.chunking.chonkie_splitter import LMStudioEmbeddings
    
    # Create instance
    embedder = LMStudioEmbeddings(
        base_url="http://localhost:1234/v1",
        model="qwen3-embedding"
    )
    
    # Verify it's a proper BaseEmbeddings subclass
    from chonkie.embeddings.base import BaseEmbeddings
    assert isinstance(embedder, BaseEmbeddings)
    print("✓ LMStudioEmbeddings is a valid BaseEmbeddings subclass")
    
    # Verify required methods exist
    assert hasattr(embedder, 'embed')
    assert hasattr(embedder, 'embed_batch')
    assert hasattr(embedder, 'similarity')
    assert hasattr(embedder, 'get_tokenizer')
    print("✓ All required methods present")
    
    return True


def test_parser_integration():
    """Test that parsers can import and use chunking."""
    print("\nTesting parser integration...")
    
    from adler_graph_reader.parser.pdf import PDFParser
    from adler_graph_reader.parser.epub import EPUBParser
    
    # Verify imports work
    print("✓ PDFParser imports chunking module successfully")
    print("✓ EPUBParser imports chunking module successfully")
    
    return True


def test_stats_method():
    """Test get_stats method."""
    print("\nTesting get_stats method...")
    
    from adler_graph_reader.chunking import create_chonkie_splitter
    
    splitter = create_chonkie_splitter()
    stats = splitter.get_stats()
    
    assert "chunk_size" in stats
    assert "similarity_threshold" in stats
    assert "min_chunk_size" in stats
    assert "embedding_model" in stats
    print(f"✓ Stats: {stats}")
    
    return True


if __name__ == "__main__":
    try:
        test_imports()
        test_chonkie_structure()
        test_lmstudio_embeddings_class()
        test_parser_integration()
        test_stats_method()
        print("\n✅ All structure tests passed!")
        print("\nNote: Full integration tests require LM Studio running at http://localhost:1234")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
