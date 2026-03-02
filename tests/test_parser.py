"""Tests for document parser module."""

import pytest

from adler_graph_reader.parser import Chunk, ParsedDocument, create_parser
from adler_graph_reader.parser.pdf import PDFParser
from adler_graph_reader.parser.epub import EPUBParser


class TestChunk:
    """Test Chunk dataclass."""

    def test_chunk_creation(self):
        """Test creating a Chunk instance."""
        chunk = Chunk(
            content="Test content",
            page_number=1,
            chapter_title="Chapter 1",
            level=1,
        )

        assert chunk.content == "Test content"
        assert chunk.page_number == 1
        assert chunk.chapter_title == "Chapter 1"
        assert chunk.level == 1

    def test_chunk_defaults(self):
        """Test Chunk with default values."""
        chunk = Chunk(content="Test content")

        assert chunk.content == "Test content"
        assert chunk.page_number is None
        assert chunk.chapter_title is None
        assert chunk.level == 0


class TestParsedDocument:
    """Test ParsedDocument dataclass."""

    def test_parsed_document_creation(self):
        """Test creating a ParsedDocument instance."""
        chunks = [
            Chunk(content="Chunk 1", page_number=1),
            Chunk(content="Chunk 2", page_number=2),
        ]

        doc = ParsedDocument(
            title="Test Document",
            chunks=chunks,
            metadata={"author": "Test Author"},
        )

        assert doc.title == "Test Document"
        assert len(doc.chunks) == 2
        assert doc.metadata["author"] == "Test Author"


class TestCreateParser:
    """Test parser factory function."""

    def test_create_pdf_parser(self, tmp_path):
        """Test creating a PDF parser."""
        pdf_file = tmp_path / "test.pdf"
        pdf_file.touch()

        parser = create_parser(pdf_file)

        assert isinstance(parser, PDFParser)

    def test_create_epub_parser(self, tmp_path):
        """Test creating an EPUB parser."""
        epub_file = tmp_path / "test.epub"
        epub_file.touch()

        parser = create_parser(epub_file)

        assert isinstance(parser, EPUBParser)

    def test_unsupported_format(self, tmp_path):
        """Test that unsupported formats raise ValueError."""
        txt_file = tmp_path / "test.txt"
        txt_file.touch()

        with pytest.raises(ValueError, match="Unsupported file format"):
            create_parser(txt_file)


class TestPDFParser:
    """Test PDF parser functionality."""

    def test_pdf_parser_init(self, tmp_path):
        """Test PDF parser initialization."""
        pdf_file = tmp_path / "test.pdf"
        pdf_file.touch()

        parser = PDFParser(pdf_file)

        assert parser.file_path == pdf_file


class TestEPUBParser:
    """Test EPUB parser functionality."""

    def test_epub_parser_init(self, tmp_path):
        """Test EPUB parser initialization."""
        epub_file = tmp_path / "test.epub"
        epub_file.touch()

        parser = EPUBParser(epub_file)

        assert parser.file_path == epub_file


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
