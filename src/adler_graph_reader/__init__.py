"""
Adler-Graph-Reader: Extract structured knowledge from PDFs/EPUBs.

Pipeline:
1. Parse documents (PDF/EPUB) into chunks with hierarchical structure
2. Generate embeddings and store in SQLite (FTS5 + sqlite-vec)
3. Extract concepts using Qwen3 via Ollama
4. Generate Obsidian-compatible Markdown with bidirectional links
"""

__version__ = "0.1.0"

from . import database
from . import knowledge
from . import llm
from . import output
from . import parser
from . import search
