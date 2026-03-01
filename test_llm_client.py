#!/usr/bin/env python3
"""
Simple test script for LLM client with instructor MD_JSON mode.
Tests both plain generation and structured output.
"""

import sys
import traceback

# Add src to path
sys.path.insert(0, "src")

from adler_graph_reader.llm.client import OllamaClient, get_default_client
from adler_graph_reader.llm.models import BookSummary


def test_plain_generation():
    """Test plain text generation."""
    print("=" * 60)
    print("Test 1: Plain Text Generation")
    print("=" * 60)

    client = OllamaClient()

    try:
        response = client.generate(
            prompt="What is the capital of France? Answer in one word.",
            system="You are a helpful assistant."
        )
        print(f"✓ Plain generation successful")
        print(f"  Response: {response[:100]}...")
        return True
    except Exception as e:
        print(f"✗ Plain generation failed: {e}")
        traceback.print_exc()
        return False


def test_structured_output():
    """Test structured output with MD_JSON mode."""
    print("\n" + "=" * 60)
    print("Test 2: Structured Output (MD_JSON mode)")
    print("=" * 60)

    client = get_default_client()

    prompt = """Analyze the following book excerpt and provide a structured summary:

Book Title: "The Art of Learning"
Author: Josh Waitzkin

Excerpt: This book explores the process of learning and mastery through the author's
experience as a chess prodigy and martial arts champion. Waitzkin shares his insights
on how to achieve peak performance by understanding the psychology of learning,
developing resilience, and mastering the fundamentals.

Key themes:
- The importance of depth over breadth in learning
- How to handle stress and pressure in high-performance situations
- The role of incremental growth in achieving mastery
- Techniques for maintaining focus and presence
"""

    try:
        result = client.generate_structured(
            prompt=prompt,
            response_model=BookSummary,
            system="You are a book analysis expert. Extract structured information about books.",
            temperature=0.3
        )

        print(f"✓ Structured output successful")
        print(f"  Category: {result.category}")
        print(f"  Core Thesis: {result.core_thesis[:100]}...")
        print(f"  Core Question: {result.core_question}")
        return True
    except Exception as e:
        print(f"✗ Structured output failed: {e}")
        traceback.print_exc()
        return False


def test_embedding():
    """Test embedding generation."""
    print("\n" + "=" * 60)
    print("Test 3: Embedding Generation")
    print("=" * 60)

    client = get_default_client()

    try:
        embedding = client.embed("This is a test sentence for embedding generation.")
        print(f"✓ Embedding generation successful")
        print(f"  Embedding dimension: {len(embedding)}")
        print(f"  First 5 values: {embedding[:5]}")
        return True
    except Exception as e:
        print(f"✗ Embedding generation failed: {e}")
        traceback.print_exc()
        return False


def test_client_singleton():
    """Test that get_default_client returns the same instance."""
    print("\n" + "=" * 60)
    print("Test 4: Client Singleton Pattern")
    print("=" * 60)

    client1 = get_default_client()
    client2 = get_default_client()

    if client1 is client2:
        print(f"✓ Singleton pattern working (same instance)")
        return True
    else:
        print(f"✗ Singleton pattern broken (different instances)")
        return False


def main():
    """Run all tests."""
    print("\n" + "=" * 60)
    print("LLM Client Test Suite")
    print("=" * 60)
    print("\nMake sure LM Studio is running at http://localhost:1234/v1")
    print("with a model loaded.\n")

    results = []

    # Run tests
    results.append(("Plain Generation", test_plain_generation()))
    results.append(("Structured Output", test_structured_output()))
    results.append(("Embedding", test_embedding()))
    results.append(("Singleton", test_client_singleton()))

    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)

    for name, passed in results:
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {status}: {name}")

    all_passed = all(passed for _, passed in results)

    print("\n" + "=" * 60)
    if all_passed:
        print("All tests passed! ✓")
    else:
        print("Some tests failed. ✗")
    print("=" * 60)

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
