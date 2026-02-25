"""
Adler-Graph-Reader: 艾德勒图谱阅读器

A CLI tool that reads PDF/EPUB documents, extracts structured knowledge
using local Qwen3 model via Ollama, and generates Obsidian-compatible
Markdown with bidirectional links.
"""

import sys

from src.adler_graph_reader.cli import main


if __name__ == "__main__":
    sys.exit(main())
