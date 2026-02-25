"""
Output module: Generate Obsidian-compatible Markdown.
"""

from .markdown import MarkdownGenerator
from .writer import ObsidianWriter

__all__ = [
    "MarkdownGenerator",
    "ObsidianWriter",
]
