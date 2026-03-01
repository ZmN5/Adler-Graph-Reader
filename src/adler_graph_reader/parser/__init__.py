"""
Document parser module.
Handles parsing of PDF and EPUB documents into chunks with hierarchical structure.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class Chunk:
    """Represents a text chunk extracted from a document."""

    content: str
    page_number: Optional[int] = None
    chapter_title: Optional[str] = None
    level: int = 0  # 0 = root, 1 = chapter, 2 = subsection, etc.


@dataclass
class ParsedDocument:
    """Represents a fully parsed document."""

    title: str
    chunks: list[Chunk]
    metadata: dict


class DocumentParser(ABC):
    """
    Abstract base class for document parsers.
    Each parser implementation handles a specific document format.
    """

    def __init__(self, file_path: Path):
        self.file_path = file_path

    @abstractmethod
    def parse(self) -> ParsedDocument:
        """Parse the document and return structured chunks."""
        pass

    @abstractmethod
    def get_title(self) -> str:
        """Extract the document title."""
        pass


# Import parsers after defining base classes to avoid circular imports
from .pdf import PDFParser  # noqa: E402
from .epub import EPUBParser  # noqa: E402


def create_parser(file_path: Path) -> DocumentParser:
    """
    Factory function to create the appropriate parser based on file extension.
    """
    suffix = file_path.suffix.lower()

    if suffix == ".pdf":
        return PDFParser(file_path)
    elif suffix in (".epub",):
        return EPUBParser(file_path)
    else:
        raise ValueError(f"Unsupported file format: {suffix}")
