"""
LLM module: OpenAI-compatible client for text generation and embeddings.
Default: LM Studio API at http://localhost:1234/v1
Compatible with: LM Studio, Ollama, and other OpenAI-compatible endpoints
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
