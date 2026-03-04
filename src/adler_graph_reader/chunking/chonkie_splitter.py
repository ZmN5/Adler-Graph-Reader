"""
Chonkie-based semantic chunking with RecursiveChunker.

This module provides intelligent text chunking using Chonkie's RecursiveChunker,
which splits text hierarchically (paragraphs -> sentences -> words) without
requiring external embedding services. This is 10x faster than SemanticChunker
and works without LM Studio running.
"""

from ..parser import Chunk, ParsedDocument


class ChonkieSplitter:
    """
    Intelligent text chunking using Chonkie's RecursiveChunker.

    RecursiveChunker splits text hierarchically:
    1. First tries to split by paragraphs (double newlines)
    2. Then by sentences (punctuation-based, supports Chinese)
    3. Finally by words/tokens

    This approach:
    - Preserves semantic boundaries better than fixed-size chunking
    - Does NOT require external embedding services
    - Is 10x faster than SemanticChunker
    - Supports Chinese text properly

    Chunk size is in tokens (approximate). For qwen3-embedding (max 8192),
    we use 1000 tokens as default for safety margin.
    """

    def __init__(
        self,
        chunk_size: int = 1000,  # Tokens per chunk (safe for 8192 limit)
        chunk_overlap: int = 100,  # Overlap between chunks
        min_chunk_size: int = 100,  # Minimum chunk size in characters
    ):
        """
        Initialize the Chonkie splitter.

        Args:
            chunk_size: Target chunk size in tokens (default 1000)
            chunk_overlap: Overlap between chunks in tokens
            min_chunk_size: Minimum chunk size in characters
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.min_chunk_size = min_chunk_size

        # Lazy initialization of Chonkie chunker
        self._chunker = None

    def _get_chunker(self):
        """Lazy initialization of Chonkie RecursiveChunker."""
        if self._chunker is None:
            try:
                from chonkie import RecursiveChunker

                self._chunker = RecursiveChunker(
                    chunk_size=self.chunk_size,
                    chunk_overlap=self.chunk_overlap,
                )
            except ImportError as e:
                raise ImportError(
                    "Chonkie is required for recursive chunking. "
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
        return {
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "min_chunk_size": self.min_chunk_size,
            "chunker_type": "RecursiveChunker",
        }


def create_chonkie_splitter(
    chunk_size: int = 1000,
    chunk_overlap: int = 100,
) -> ChonkieSplitter:
    """
    Factory function to create a ChonkieSplitter instance.

    Args:
        chunk_size: Target chunk size in tokens (default 1000)
        chunk_overlap: Overlap between chunks in tokens (default 100)

    Returns:
        Configured ChonkieSplitter instance
    """
    return ChonkieSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
