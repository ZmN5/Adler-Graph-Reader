"""
Chonkie-based semantic chunking with LM Studio embedding support.

This module provides intelligent text chunking using Chonkie's SemanticChunker,
with a custom embedding class that calls LM Studio's API for qwen3 embeddings.
"""

from typing import Optional
import numpy as np
from openai import OpenAI

from chonkie.embeddings.base import BaseEmbeddings

from ..parser import Chunk, ParsedDocument


class LMStudioEmbeddings(BaseEmbeddings):
    """
    Custom embedding class for Chonkie that uses LM Studio API.

    This wraps the LM Studio OpenAI-compatible API to provide embeddings
    for Chonkie's semantic chunking algorithm.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:1234/v1",
        model: str = "text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-qwen3-embedding-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b",
        timeout: float = 60.0,
    ):
        super().__init__()
        self.base_url = base_url
        self.model = model
        self.timeout = timeout
        self._client: Optional[OpenAI] = None
        self._embedding_dim: Optional[int] = None

    def _get_client(self) -> OpenAI:
        """Lazy initialization of OpenAI client."""
        if self._client is None:
            self._client = OpenAI(
                base_url=self.base_url,
                api_key="not-needed",
                timeout=self.timeout,
            )
        return self._client

    def embed(self, text: str) -> np.ndarray:
        """
        Generate embedding for a single text.

        Args:
            text: Text string to embed

        Returns:
            numpy array of shape (embedding_dim,)
        """
        result = self.embed_batch([text])
        return result[0]

    def embed_batch(self, texts: list[str]) -> np.ndarray:
        """
        Generate embeddings for multiple texts.

        Args:
            texts: List of text strings to embed

        Returns:
            numpy array of shape (len(texts), embedding_dim)
        """
        client = self._get_client()

        response = client.embeddings.create(
            model=self.model,
            input=texts,
        )

        # Sort by index to ensure correct order
        sorted_data = sorted(response.data, key=lambda x: x.index)
        embeddings = [item.embedding for item in sorted_data]

        # Store dimension for later reference
        if embeddings and self._embedding_dim is None:
            self._embedding_dim = len(embeddings[0])

        return np.array(embeddings)

    def similarity(self, u: np.ndarray, v: np.ndarray) -> float:
        """
        Compute cosine similarity between two embeddings.

        Args:
            u: First embedding vector
            v: Second embedding vector

        Returns:
            Cosine similarity score
        """
        return np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v))

    @property
    def dimension(self) -> int:
        """Get the embedding dimension."""
        if self._embedding_dim is None:
            # Test embedding to determine dimension
            test_result = self.embed("test")
            self._embedding_dim = len(test_result)
        return self._embedding_dim

    @property
    def model_name(self) -> str:
        """Get the model name."""
        return self.model

    def get_tokenizer(self):
        """Get a default tokenizer for Chonkie."""
        # Use a lightweight tokenizer for sentence splitting
        from chonkie.tokenizer import AutoTokenizer

        return AutoTokenizer("gpt2")  # gpt2 tokenizer is small and fast


class ChonkieSplitter:
    """
    Intelligent semantic chunking using Chonkie with LM Studio embeddings.

    Replaces simple paragraph splitting with semantic-aware chunking that:
    - Groups semantically similar sentences together
    - Respects token limits (max 400 tokens per chunk for safety)
    - Maintains document structure (chapter/page info)
    """

    def __init__(
        self,
        chunk_size: int = 400,  # Conservative limit for qwen3 embedding (max 8192)
        similarity_threshold: float = 0.7,
        min_chunk_size: int = 50,
        embedding_base_url: str = "http://localhost:1234/v1",
        embedding_model: str = "text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-qwen3-embedding-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b",
    ):
        """
        Initialize the Chonkie splitter.

        Args:
            chunk_size: Target chunk size in tokens (default 400, safe for 8192 limit)
            similarity_threshold: Semantic similarity threshold for grouping (0-1)
            min_chunk_size: Minimum chunk size in characters
            embedding_base_url: LM Studio API base URL
            embedding_model: Name of the embedding model in LM Studio
        """
        self.chunk_size = chunk_size
        self.similarity_threshold = similarity_threshold
        self.min_chunk_size = min_chunk_size

        # Create custom embedding model for Chonkie
        self.embedding_model = LMStudioEmbeddings(
            base_url=embedding_base_url,
            model=embedding_model,
        )

        # Lazy initialization of Chonkie chunker
        self._chunker = None

    def _get_chunker(self):
        """Lazy initialization of Chonkie SemanticChunker."""
        if self._chunker is None:
            try:
                from chonkie import SemanticChunker

                self._chunker = SemanticChunker(
                    embedding_model=self.embedding_model,
                    threshold=self.similarity_threshold,
                    chunk_size=self.chunk_size,
                    min_sentences_per_chunk=1,
                )
            except ImportError as e:
                raise ImportError(
                    "Chonkie is required for semantic chunking. "
                    "Install with: uv add chonkie>=0.5.0"
                ) from e

        return self._chunker

    def split_text(self, text: str) -> list[str]:
        """
        Split text into semantic chunks.

        Args:
            text: Input text to split

        Returns:
            List of text chunks
        """
        chunker = self._get_chunker()
        chunks = chunker.chunk(text)

        # Extract text content from Chonkie chunks
        return [chunk.text for chunk in chunks]

    def chunk(self, text: str):
        """
        Chunk text and return Chonkie chunk objects with metadata.

        Args:
            text: Input text to split

        Returns:
            List of Chonkie chunk objects with .text and .token_count attributes
        """
        chunker = self._get_chunker()
        return chunker.chunk(text)

    def process_document(self, parsed_doc: ParsedDocument) -> ParsedDocument:
        """
        Re-chunk a parsed document using semantic chunking.

        This takes an already parsed document and re-chunks its content
        using Chonkie's semantic chunking, while preserving metadata
        like chapter titles and page numbers.

        Args:
            parsed_doc: Original parsed document with potentially many small chunks

        Returns:
            New ParsedDocument with fewer, semantically coherent chunks
        """
        # Combine all content into full text
        full_text_parts = []
        chunk_metadata = []  # Track metadata for each original chunk

        for i, chunk in enumerate(parsed_doc.chunks):
            if len(chunk.content.strip()) >= self.min_chunk_size:
                full_text_parts.append(chunk.content)
                chunk_metadata.append(
                    {
                        "index": i,
                        "page_number": chunk.page_number,
                        "chapter_title": chunk.chapter_title,
                        "level": chunk.level,
                    }
                )

        if not full_text_parts:
            return parsed_doc

        # Join with clear separators for semantic chunking
        full_text = "\n\n".join(full_text_parts)

        # Perform semantic chunking
        semantic_chunks = self.split_text(full_text)

        # Create new chunks with preserved metadata
        new_chunks: list[Chunk] = []

        for chunk_text in semantic_chunks:
            # Find the most appropriate metadata for this chunk
            # Use the first non-empty chapter title we can find
            best_page = None
            best_chapter = None
            best_level = 1

            for meta in chunk_metadata:
                if meta["chapter_title"]:
                    best_chapter = meta["chapter_title"]
                    best_page = meta["page_number"]
                    best_level = meta["level"]
                    break

            if not best_chapter and chunk_metadata:
                # Fallback to first available metadata
                best_page = chunk_metadata[0]["page_number"]
                best_level = chunk_metadata[0]["level"]

            new_chunks.append(
                Chunk(
                    content=chunk_text,
                    page_number=best_page,
                    chapter_title=best_chapter,
                    level=best_level,
                )
            )

        # Update metadata with chunking info
        new_metadata = {
            **parsed_doc.metadata,
            "semantic_chunking": True,
            "original_chunks": len(parsed_doc.chunks),
            "new_chunks": len(new_chunks),
            "chunk_size_limit": self.chunk_size,
        }

        return ParsedDocument(
            title=parsed_doc.title,
            chunks=new_chunks,
            metadata=new_metadata,
        )

    def get_stats(self) -> dict:
        """Get statistics about the chunker configuration."""
        stats = {
            "chunk_size": self.chunk_size,
            "similarity_threshold": self.similarity_threshold,
            "min_chunk_size": self.min_chunk_size,
            "embedding_model": self.embedding_model.model,
        }
        # Only include dimension if already determined
        if self.embedding_model._embedding_dim is not None:
            stats["embedding_dim"] = self.embedding_model._embedding_dim
        else:
            stats["embedding_dim"] = "unknown (LM Studio not connected)"
        return stats


def create_chonkie_splitter(
    chunk_size: int = 400,
    similarity_threshold: float = 0.7,
    embedding_base_url: str = "http://localhost:1234/v1",
    embedding_model: str = "text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-text-embedding-qwen3-embedding-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b-0.6b",
) -> ChonkieSplitter:
    """
    Factory function to create a ChonkieSplitter instance.

    Args:
        chunk_size: Target chunk size in tokens
        similarity_threshold: Semantic similarity threshold
        embedding_base_url: LM Studio API URL
        embedding_model: Model name in LM Studio

    Returns:
        Configured ChonkieSplitter instance
    """
    return ChonkieSplitter(
        chunk_size=chunk_size,
        similarity_threshold=similarity_threshold,
        embedding_base_url=embedding_base_url,
        embedding_model=embedding_model,
    )
