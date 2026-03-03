"""
Simple paragraph-based text chunking without embeddings.
"""

import re
from dataclasses import dataclass


@dataclass
class SimpleChunk:
    """Simple chunk representation."""
    text: str
    start_idx: int
    end_idx: int


class SimpleChunker:
    """
    Simple paragraph-based text chunker.
    
    Splits text by paragraphs and groups them into chunks of roughly
    the target size. No embeddings required - much faster than semantic chunking.
    """

    def __init__(
        self,
        chunk_size: int = 1000,  # Characters per chunk
        overlap: int = 100,  # Overlap between chunks
        min_chunk_size: int = 200,
    ):
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.min_chunk_size = min_chunk_size

    def chunk(self, text: str) -> list[SimpleChunk]:
        """
        Split text into chunks.
        
        Args:
            text: Input text to chunk
            
        Returns:
            List of SimpleChunk objects
        """
        if not text or not text.strip():
            return []

        # Split by double newlines (paragraphs)
        paragraphs = re.split(r'\n\s*\n', text)
        paragraphs = [p.strip() for p in paragraphs if p.strip()]
        
        if not paragraphs:
            # Fall back to single lines
            paragraphs = text.split('\n')
            paragraphs = [p.strip() for p in paragraphs if p.strip()]

        chunks: list[SimpleChunk] = []
        current_chunk_text = ""
        current_start = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
                
            # If adding this paragraph would exceed chunk size, save current chunk
            if len(current_chunk_text) + len(para) + 2 > self.chunk_size and current_chunk_text:
                chunks.append(SimpleChunk(
                    text=current_chunk_text.strip(),
                    start_idx=current_start,
                    end_idx=current_start + len(current_chunk_text)
                ))
                
                # Start new chunk with overlap
                overlap_text = current_chunk_text[-self.overlap:] if len(current_chunk_text) > self.overlap else current_chunk_text
                current_chunk_text = overlap_text + "\n\n" + para
                current_start = current_start + len(current_chunk_text) - len(overlap_text) - len(para) - 2
            else:
                # Add to current chunk
                if current_chunk_text:
                    current_chunk_text += "\n\n" + para
                else:
                    current_chunk_text = para
                    current_start = text.find(para)

        # Don't forget the last chunk
        if current_chunk_text.strip():
            chunks.append(SimpleChunk(
                text=current_chunk_text.strip(),
                start_idx=current_start,
                end_idx=current_start + len(current_chunk_text)
            ))

        return chunks


def create_simple_chunker(
    chunk_size: int = 1000,
    overlap: int = 100,
) -> SimpleChunker:
    """Factory function to create a SimpleChunker."""
    return SimpleChunker(chunk_size=chunk_size, overlap=overlap)