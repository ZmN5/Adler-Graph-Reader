"""
LLM module: Ollama client for text generation and embeddings.
"""

from .client import OllamaClient, get_default_client
from .models import (
    BookSummary,
    ConceptExtraction,
    ConceptNode,
    Argument,
)

__all__ = [
    "OllamaClient",
    "get_default_client",
    "BookSummary",
    "ConceptExtraction",
    "ConceptNode",
    "Argument",
]
