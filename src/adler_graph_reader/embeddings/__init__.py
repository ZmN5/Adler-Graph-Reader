"""
Embedding providers with dual-mode support.
Supports both LM Studio API and local sentence-transformers.
"""

from .provider import EmbeddingProvider, create_embedding_provider

__all__ = ["EmbeddingProvider", "create_embedding_provider"]