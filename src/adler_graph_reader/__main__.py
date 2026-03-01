"""
Entry point for running as a module: python -m src.adler_graph_reader
"""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
