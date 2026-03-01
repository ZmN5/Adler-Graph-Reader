#!/usr/bin/env python3
"""
Test script to verify LM Studio API connection.
"""

import sys
from adler_graph_reader.llm import get_default_client


def test_connection():
    """Test basic connectivity to LM Studio API."""
    print("Testing LM Studio connection...")
    print("=" * 50)

    try:
        # Get default client (LM Studio configuration)
        client = get_default_client()
        print(f"✓ Base URL: {client.base_url}")
        print(f"✓ Model: {client.model}")
        print(f"✓ Embed Model: {client.embed_model}")
        print()

        # Test 1: Simple text generation
        print("Test 1: Simple text generation...")
        response = client.generate(
            prompt="What is 2 + 2? Answer with just the number.",
            temperature=0.1,
        )
        print(f"✓ Response: {response.strip()}")
        print()

        # Test 2: System message + generation
        print("Test 2: System message...")
        response = client.generate(
            prompt="Say hello briefly.",
            system="You are a helpful assistant.",
            temperature=0.7,
        )
        print(f"✓ Response: {response.strip()}")
        print()

        # Test 3: Embeddings
        print("Test 3: Embeddings...")
        embedding = client.embed("This is a test sentence.")
        print(f"✓ Embedding dimension: {len(embedding)}")
        print(f"✓ First 5 values: {embedding[:5]}")
        print()

        # Test 4: Structured output (requires instructor)
        print("Test 4: Structured output...")
        from adler_graph_reader.llm.models import BookSummary

        summary = client.generate_structured(
            prompt="""Analyze this short text and provide a structured summary:

The book 'Deep Learning' by Ian Goodfellow covers neural networks,
optimization algorithms, and convolutional networks.
It teaches readers how to build and train deep neural networks.
""",
            response_model=BookSummary,
            system="You are a book analysis expert.",
            temperature=0.3,
        )
        print(f"✓ Category: {summary.category}")
        print(f"✓ Core Thesis: {summary.core_thesis}")
        print(f"✓ Core Question: {summary.core_question}")
        print()

        print("=" * 50)
        print("✅ All tests passed! LM Studio is working correctly.")
        return 0

    except Exception as e:
        print(f"\n❌ Error: {e}")
        print()
        print("Troubleshooting:")
        print("1. Make sure LM Studio is running")
        print("2. Check that a model is loaded in LM Studio")
        print("3. Verify the server is started in LM Studio (Developer tab)")
        print("4. Check that the API is listening on http://localhost:1234/v1")
        return 1


if __name__ == "__main__":
    sys.exit(test_connection())
