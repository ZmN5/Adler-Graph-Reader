"""
CLI interface for Adler-Graph-Reader.
"""

import argparse
import sys
from pathlib import Path

from . import database
from .config import get_config, set_language
from .knowledge.models import BookAnalysis, ConceptNode
from .knowledge.graph import KnowledgeGraph, QATracker
from .llm import get_default_client, OllamaClient
from .llm.models import BookSummary, ConceptExtraction
from .output import MarkdownGenerator, ObsidianWriter
from .parser import create_parser
from .search import HybridSearchEngine


def _is_database_initialized() -> bool:
    """Check if database file exists and has required tables."""
    if not database.DB_PATH.exists():
        return False
    try:
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}
        conn.close()
        # Check for core tables
        required = {"document_tree", "fts_chunks", "vec_chunks", "themes", "concepts"}
        return required.issubset(tables)
    except Exception:
        return False


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="艾德勒图谱阅读器 - Extract knowledge from books"
    )

    # Global options
    parser.add_argument(
        "--language",
        "-l",
        choices=["zh", "en"],
        default="en",
        help="Output language (zh=Chinese, en=English; default: zh)",
    )

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # ingest command
    ingest = subparsers.add_parser("ingest", help="Ingest a document")
    ingest.add_argument(
        "file",
        type=Path,
        nargs="?",
        help="PDF, EPUB, MOBI, AZW3, or TXT file",
    )
    ingest.add_argument("--title", help="Override title")
    ingest.add_argument(
        "--batch",
        type=Path,
        metavar="DIR",
        help="Batch ingest all supported files from directory",
    )

    # analyze command
    analyze = subparsers.add_parser("analyze", help="Analyze a document")
    analyze.add_argument("file", type=Path, help="PDF or EPUB file")
    analyze.add_argument("--output", "-o", type=Path, default=Path("output"))

    # search command
    search = subparsers.add_parser("search", help="Search concepts")
    search.add_argument("query", help="Search query")
    search.add_argument("--document", "-d", required=True, help="Document ID")

    # extract-themes command
    extract_themes = subparsers.add_parser(
        "extract-themes", help="Extract themes from document"
    )
    extract_themes.add_argument("--document", "-d", required=True, help="Document ID")

    # extract-concepts command
    extract_concepts = subparsers.add_parser(
        "extract-concepts", help="Extract concepts from document"
    )
    extract_concepts.add_argument("--document", "-d", required=True, help="Document ID")
    extract_concepts.add_argument(
        "--theme-ids", nargs="*", type=int, help="Theme IDs to associate concepts with"
    )

    # extract-relations command
    extract_relations = subparsers.add_parser(
        "extract-relations", help="Extract concept relations"
    )
    extract_relations.add_argument(
        "--document", "-d", required=True, help="Document ID"
    )

    # build-graph command (complete pipeline)
    build_graph = subparsers.add_parser(
        "build-graph",
        help="Complete pipeline: ingest + extract themes/concepts/relations",
    )
    build_graph.add_argument(
        "file",
        type=Path,
        nargs="?",
        help="PDF or EPUB file (skip if document already ingested)",
    )
    build_graph.add_argument(
        "--document", "-d", help="Document ID (required if file not provided)"
    )
    build_graph.add_argument(
        "--all",
        action="store_true",
        help="Build graph for all documents in database",
    )

    # process command (one-command pipeline with auto-init-db)
    process_cmd = subparsers.add_parser(
        "process",
        help="One-command pipeline: auto-init-db + ingest + build-graph",
    )
    process_cmd.add_argument(
        "file",
        type=Path,
        nargs="?",
        help="Document file (PDF, EPUB, MOBI, AZW3, or TXT)",
    )
    process_cmd.add_argument("--title", help="Override document title")
    process_cmd.add_argument(
        "--batch",
        type=Path,
        metavar="DIR",
        help="Batch process all supported files from directory",
    )
    process_cmd.add_argument(
        "--all",
        action="store_true",
        dest="process_all",
        help="Process all documents in database without existing concepts",
    )

    # graph command
    graph = subparsers.add_parser("graph", help="View knowledge graph")
    graph.add_argument("--document", "-d", required=True, help="Document ID")
    graph.add_argument(
        "--format",
        choices=["text", "json", "viz", "dot"],
        default="text",
        help="Output format",
    )

    # export-graph command
    export_graph = subparsers.add_parser(
        "export-graph", help="Export knowledge graph to file"
    )
    export_graph.add_argument("--document", "-d", required=True, help="Document ID")
    export_graph.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("output/graph"),
        help="Output directory",
    )
    export_graph.add_argument(
        "--format",
        choices=["dot", "svg", "json", "graphml", "gexf"],
        default="graphml",
        help="Export format (default: graphml)",
    )
    # Keep --formats for backward compatibility
    export_graph.add_argument(
        "--formats",
        nargs="+",
        choices=["dot", "svg", "json", "graphml", "gexf"],
        default=None,
        help="Export formats (deprecated, use --format instead)",
    )
    export_graph.add_argument(
        "--layout",
        choices=["dot", "neato", "fdp", "sfdp", "circo"],
        default="dot",
        help="Graphviz layout",
    )

    # qa command
    qa = subparsers.add_parser("qa", help="Ask questions about the document")
    qa.add_argument("question", help="Question to ask")
    qa.add_argument("--document", "-d", required=True, help="Document ID")
    qa.add_argument("--session", "-s", help="Session ID (creates new if not provided)")

    # init-db command
    subparsers.add_parser("init-db", help="Initialize database")

    # api command
    api = subparsers.add_parser("api", help="Start FastAPI server")
    api.add_argument(
        "--host", type=str, default="0.0.0.0", help="Host to bind (default: 0.0.0.0)"
    )
    api.add_argument(
        "--port", "-p", type=int, default=8000, help="Port number (default: 8000)"
    )
    api.add_argument("--reload", "-r", action="store_true", help="Enable auto-reload")

    # ui command (disabled - new UI in development)
    ui = subparsers.add_parser("ui", help="Launch web UI (temporarily disabled)")
    ui.add_argument(
        "--port", "-p", type=int, default=8501, help="Port number (default: 8501)"
    )
    ui.add_argument(
        "--browser",
        "-b",
        action="store_true",
        default=True,
        help="Open browser automatically",
    )
    ui.add_argument(
        "--no-browser",
        "-n",
        dest="browser",
        action="store_false",
        help="Don't open browser automatically",
    )

    return parser.parse_args()


def cmd_ingest(
    file: Path,
    title: str | None = None,
    llm_client: OllamaClient | None = None,
) -> str:
    """Ingest a document into the database."""
    if llm_client is None:
        llm_client = get_default_client(force_reset=True)

    # Parse document
    print(f"Parsing {file.name}...")
    parser = create_parser(file)

    with parser:
        parsed = parser.parse()

    document_id = title or parsed.title

    # Initialize database
    print("Initializing database...")
    conn = database.init_database()

    # Insert chunks with parent tracking
    print(f"Inserting {len(parsed.chunks)} chunks...")
    chapter_id = None

    for chunk in parsed.chunks:
        if chunk.level == 1:
            # New chapter
            chapter_id = database.insert_chunk(
                conn,
                content=chunk.content,
                document_id=document_id,
                chunk_type="chapter",
                page_number=chunk.page_number,
            )
        else:
            # Content chunk
            chunk_id = database.insert_chunk(
                conn,
                content=chunk.content,
                document_id=document_id,
                chunk_type="chunk",
                parent_id=chapter_id,
                page_number=chunk.page_number,
            )

            # Generate and store embedding
            print(f"Generating embedding for chunk {chunk_id}...")
            embedding = llm_client.embed(chunk.content)
            database.insert_embedding(conn, chunk_id, embedding)

    conn.close()
    return document_id


def cmd_analyze(
    file: Path,
    output_dir: Path,
    llm_client: OllamaClient | None = None,
) -> None:
    """Full pipeline: ingest -> analyze -> generate."""
    if llm_client is None:
        llm_client = get_default_client()

    # 1. Ingest
    print("=== Stage 1: Ingestion ===")
    document_id = cmd_ingest(file, llm_client=llm_client)

    # 2. Map-Reduce summarization
    print("\n=== Stage 2: Book Analysis ===")
    conn = database.get_connection()

    # Get chapters for analysis
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, content FROM document_tree
        WHERE document_id = ? AND type = 'chapter'
        ORDER BY id
        """,
        (document_id,),
    )
    chapters = [
        {"id": row[0], "title": row[1][:100], "content": row[1]}
        for row in cursor.fetchall()
    ]

    # Generate book summary
    summary = llm_client.generate_structured(
        prompt=f"请分析以下书籍内容，提取核心主旨、大纲和作者要解决的问题：\n\n{chr(10).join([c['content'][:500] for c in chapters[:5]])}",
        response_model=BookSummary,
        system="你是一个专业的书籍分析专家。",
    )

    # Convert to BookAnalysis
    analysis = BookAnalysis(
        category=summary.category,
        core_thesis=summary.core_thesis,
        outline=summary.outline,
        core_question=summary.core_question,
        chapters=[],  # Could populate from chapter summaries
    )

    # 3. Hybrid search & concept extraction
    print("\n=== Stage 3: Concept Extraction ===")
    search_engine = HybridSearchEngine(conn, llm_client)

    # Get key concepts (from book analysis or manual)
    key_concepts = analysis.core_thesis.split()[:10]  # Simple heuristic

    concepts: list[ConceptNode] = []
    for concept_query in key_concepts:
        if len(concept_query) < 3:
            continue

        print(f"Searching for: {concept_query}")
        results = search_engine.search(concept_query, document_id, top_k=3)

        if not results:
            continue

        # Build context from results
        context = "\n\n".join(
            [r.content + "\n(上下文: " + " ".join(r.context) + ")" for r in results]
        )

        # Extract concepts
        extraction = llm_client.generate_structured(
            prompt=f'从以下上下文中提取关于"{concept_query}"的概念定义和论证：\n\n{context}',
            response_model=ConceptExtraction,
            system="你是一个知识提取专家。",
        )

        concepts.extend(extraction.concepts)

    conn.close()

    # 4. Generate Markdown
    print("\n=== Stage 4: Markdown Generation ===")
    generator = MarkdownGenerator()

    book_content = generator.generate_book_index(document_id, analysis)
    concept_pages = [generator.generate_concept_page(c) for c in concepts]

    writer = ObsidianWriter(output_dir)
    output_path = writer.write_book(document_id, book_content, concept_pages)

    print(f"\nDone! Output written to: {output_path}")


def cmd_search(
    query: str,
    document_id: str,
) -> None:
    """Search concepts in a document."""
    llm_client = get_default_client()
    conn = database.get_admin_connection()

    engine = HybridSearchEngine(conn, llm_client)
    results = engine.search(query, document_id, top_k=5)

    print(f"\n=== Search Results for: {query} ===\n")
    for i, r in enumerate(results, 1):
        print(f"{i}. [Page {r.page_number}] Score: {r.score:.3f}")
        print(f"   {r.content[:200]}...")
        print()

    conn.close()


def cmd_extract_themes(document_id: str) -> None:
    """Extract themes from a document."""
    conn = database.get_admin_connection()
    graph = KnowledgeGraph(conn)

    print(f"Extracting themes for: {document_id}")
    themes = graph.extract_themes(document_id)

    print(f"\n=== Extracted {len(themes)} themes ===\n")
    for i, theme in enumerate(themes, 1):
        print(f"{i}. {theme.name}")
        print(f"   {theme.description}")
        print(f"   Importance: {theme.importance_score:.2f}")
        print()

    graph.close()


def cmd_extract_concepts(document_id: str, theme_ids: list[int] | None = None) -> None:
    """Extract concepts from a document."""
    conn = database.get_admin_connection()
    graph = KnowledgeGraph(conn)

    print(f"Extracting concepts for: {document_id}")
    concepts = graph.extract_concepts(document_id, theme_ids)

    print(f"\n=== Extracted {len(concepts)} concepts ===\n")
    for i, concept in enumerate(concepts, 1):
        print(f"{i}. {concept.name}")
        print(f"   {concept.definition}")
        if concept.examples:
            print(f"   Examples: {', '.join(concept.examples[:2])}")
        print(f"   Importance: {concept.importance_score:.2f}")
        print()

    graph.close()


def cmd_extract_relations(document_id: str) -> None:
    """Extract concept relations from a document."""
    conn = database.get_admin_connection()
    graph = KnowledgeGraph(conn)

    print(f"Extracting relations for: {document_id}")
    relations = graph.extract_relations(document_id)

    print(f"\n=== Extracted {len(relations)} relations ===\n")
    for i, rel in enumerate(relations, 1):
        print(
            f"{i}. {rel.source_concept_id} --[{rel.relation_type}]--> {rel.target_concept_id}"
        )
        print(f"   Strength: {rel.strength:.2f}")
        if rel.evidence:
            print(f"   Evidence: {rel.evidence[:100]}...")
        print()

    graph.close()


def cmd_build_graph(
    file: Path | None = None,
    document_id: str | None = None,
) -> str:
    """
    Complete pipeline: ingest document + extract themes + concepts + relations.
    Returns the document_id.
    """
    # Step 1: Determine document_id
    if file:
        # Ingest the file
        print("=== Step 1: Ingesting document ===")
        document_id = cmd_ingest(file)
        print(f"Document ingested: {document_id}\n")
    elif document_id:
        # Verify document exists
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM document_tree WHERE document_id = ?", (document_id,)
        )
        count = cursor.fetchone()[0]
        conn.close()
        if count == 0:
            print(f"Error: Document '{document_id}' not found in database.")
            print("Please provide a file to ingest, or use an existing document ID.")
            sys.exit(1)
    else:
        print("Error: Please provide either a file or document ID (-d)")
        sys.exit(1)

    # Step 2: Extract themes
    print("=== Step 2: Extracting themes ===")
    conn = database.get_admin_connection()
    graph = KnowledgeGraph(conn)
    themes = graph.extract_themes(document_id)
    print(f"Extracted {len(themes)} themes\n")
    graph.close()

    # Step 3: Extract concepts
    print("=== Step 3: Extracting concepts ===")
    conn = database.get_admin_connection()
    graph = KnowledgeGraph(conn)
    theme_ids = [t.id for t in themes if t.id] if themes else None
    concepts = graph.extract_concepts(document_id, theme_ids)
    print(f"Extracted {len(concepts)} concepts\n")
    graph.close()

    # Step 4: Extract relations
    print("=== Step 4: Extracting relations ===")
    conn = database.get_admin_connection()
    graph = KnowledgeGraph(conn)
    relations = graph.extract_relations(document_id)
    print(f"Extracted {len(relations)} relations\n")
    graph.close()

    # Summary
    print("=" * 50)
    print("Knowledge graph built successfully!")
    print(f"  Document: {document_id}")
    print(f"  Themes: {len(themes)}")
    print(f"  Concepts: {len(concepts)}")
    print(f"  Relations: {len(relations)}")
    print("=" * 50)

    print("\nUsage:")
    print(f'  View graph: uv run python main.py graph -d "{document_id}"')
    print(
        f'  Ask questions: uv run python main.py qa "your question" -d "{document_id}"'
    )

    return document_id


def cmd_process(
    file: Path | None = None,
    batch: Path | None = None,
    process_all: bool = False,
    title: str | None = None,
) -> None:
    """
    One-command pipeline: init-db (if needed) + ingest + build-graph.
    """
    # Step 1: Check and initialize database if needed
    if not _is_database_initialized():
        print("Database not initialized. Initializing...")
        database.init_database()
        print("Database initialized.")
    else:
        print("Database already initialized.")

    # Step 2: Process documents
    if process_all:
        # Process all documents without concepts
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT document_id FROM document_tree
            WHERE document_id NOT IN (SELECT DISTINCT document_id FROM concepts)
            ORDER BY document_id
            """
        )
        doc_ids = [row[0] for row in cursor.fetchall()]
        conn.close()
        if not doc_ids:
            print("No documents found without existing concepts.")
            return
        print(f"Found {len(doc_ids)} documents to process")
        for doc_id in doc_ids:
            print(f"\n=== Processing: {doc_id} ===")
            cmd_build_graph(None, doc_id)
        print(f"\nBatch processing complete: {len(doc_ids)} documents processed.")
    elif batch:
        # Batch process directory
        if not batch.is_dir():
            print(f"Error: {batch} is not a directory")
            return
        supported_exts = (".pdf", ".epub", ".mobi", ".azw3", ".txt")
        files = sorted(
            [f for f in batch.iterdir() if f.suffix.lower() in supported_exts]
        )
        if not files:
            print(f"No supported files found in {batch}")
            return
        print(f"Found {len(files)} files to process")
        for f in files:
            print(f"\n{'=' * 50}")
            print(f"Processing: {f.name}")
            print("=" * 50)
            cmd_build_graph(f, title)
        print(f"\nBatch processing complete: {len(files)} files processed.")
    elif file:
        # Single file
        cmd_build_graph(file, title)
    else:
        print("Error: Please provide a file, --batch, or --all")


def cmd_graph(document_id: str, format: str = "text") -> None:
    """View knowledge graph for a document."""
    conn = database.get_admin_connection()
    graph = KnowledgeGraph(conn)

    if format == "json":
        import json

        data = database.get_document_graph(conn, document_id)
        print(json.dumps(data, indent=2, ensure_ascii=False))
    elif format == "viz":
        viz = graph.to_visualization(document_id)
        print(viz.model_dump_json(indent=2))
    elif format == "dot":
        # Export to DOT and print
        import tempfile

        with tempfile.NamedTemporaryFile(mode="w", suffix=".dot", delete=False) as f:
            dot_path = graph.export_dot(document_id, Path(f.name))
        with open(dot_path, "r") as f:
            print(f.read())
        dot_path.unlink()  # Clean up
    else:
        # Text format
        graph_data = graph.get_graph(document_id)

        print(f"\n=== Themes ({len(graph_data.themes)}) ===\n")
        for theme in graph_data.themes:
            print(f"- {theme.name}: {theme.description}")

        print(f"\n=== Concepts ({len(graph_data.concepts)}) ===\n")
        for concept in graph_data.concepts:
            print(f"- {concept.name}: {concept.definition[:80]}...")
            if hasattr(concept, "explanation") and concept.explanation:
                print(f"  {concept.explanation[:100]}...")
            if concept.examples:
                print(f"  Examples: {', '.join(concept.examples[:2])}")

        print(f"\n=== Relations ({len(graph_data.relations)}) ===\n")
        for rel in graph_data.relations:
            source_name = rel.source_concept_id
            target_name = rel.target_concept_id
            print(
                f"- {source_name} --[{rel.relation_type}:{rel.strength:.2f}]--> {target_name}"
            )
            if rel.evidence:
                print(f"  Evidence: {rel.evidence[:80]}...")

    graph.close()


def cmd_export_graph(
    document_id: str,
    output_dir: Path,
    formats: list[str],
    layout: str = "dot",
) -> None:
    """Export knowledge graph to files."""
    conn = database.get_admin_connection()
    graph = KnowledgeGraph(conn)

    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Exporting graph for: {document_id} ===\n")

    if "dot" in formats:
        dot_path = output_dir / f"{document_id}.dot"
        graph.export_dot(document_id, dot_path, layout=layout)
        print(f"Exported DOT: {dot_path}")

    if "svg" in formats:
        svg_path = output_dir / f"{document_id}.svg"
        result_path = graph.export_svg(document_id, svg_path)
        print(f"Exported SVG: {result_path}")

    if "json" in formats:
        json_path = output_dir / f"{document_id}_graph.json"
        graph.export_json(document_id, json_path)
        print(f"Exported JSON: {json_path}")

    if "graphml" in formats:
        from .export import GraphMLExporter

        graphml_path = output_dir / f"{document_id}.graphml"
        exporter = GraphMLExporter()
        graph_data = graph.get_graph(document_id)
        exporter.export(
            themes=[t.model_dump() for t in graph_data.themes],
            concepts=[c.model_dump() for c in graph_data.concepts],
            relations=[r.model_dump() for r in graph_data.relations],
            output_path=graphml_path,
        )
        print(f"Exported GraphML: {graphml_path}")

    if "gexf" in formats:
        from .export import GEXFExporter

        gexf_path = output_dir / f"{document_id}.gexf"
        exporter = GEXFExporter()
        graph_data = graph.get_graph(document_id)
        exporter.export(
            themes=[t.model_dump() for t in graph_data.themes],
            concepts=[c.model_dump() for c in graph_data.concepts],
            relations=[r.model_dump() for r in graph_data.relations],
            output_path=gexf_path,
        )
        print(f"Exported GEXF: {gexf_path}")

    print("\nExport complete!")
    graph.close()


def cmd_qa(question: str, document_id: str, session_id: str | None = None) -> None:
    """Ask a question about the document."""
    conn = database.get_admin_connection()
    tracker = QATracker(conn)

    if session_id is None:
        session_id = tracker.create_session()
        print(f"New session: {session_id}")
    else:
        # Show history
        history = tracker.get_history(session_id)
        if history:
            print("\n=== Session History ===\n")
            for h in history[-3:]:
                print(f"Q: {h.question}")
                print(f"A: {h.answer[:200]}...")
                print()

    print(f"\n=== Question ===\n{question}\n")

    result = tracker.ask(document_id, question, session_id)

    print("=== Answer ===\n")
    print(result["answer"])
    print(f"\nConfidence: {result.get('confidence', 0):.2f}")
    print(f"Cited concepts: {len(result.get('cited_concept_ids', []))}")

    tracker.close()


def cmd_ui(port: int = 8501, open_browser: bool = True):
    """Launch web UI with FastAPI backend and React frontend."""
    import subprocess
    import threading
    import webbrowser
    import signal
    import time

    # Check frontend build exists
    frontend_dist = Path(__file__).parent.parent.parent / "ui" / "frontend" / "dist"
    if not frontend_dist.exists():
        print("Error: Frontend build not found.")
        print(f"Expected directory: {frontend_dist}")
        print("\nTo build the frontend:")
        print("  cd ui/frontend && npm install && npm run build")
        return

    # Create a new app with static files
    from fastapi import FastAPI
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse
    from fastapi.middleware.cors import CORSMiddleware

    from .api.routes import router as api_router

    # Create combined app
    app = FastAPI(title="Adler Graph Reader UI")

    # Add CORS middleware to allow frontend access
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins for local development
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include API routes directly with /api prefix
    app.include_router(api_router, prefix="/api")

    # Mount static files
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(frontend_dist / "index.html"))

    @app.get("/{path:path}")
    async def serve_spa(path: str):
        # Serve index.html for all routes (SPA behavior)
        index_file = frontend_dist / path
        if index_file.exists() and index_file.is_file():
            return FileResponse(str(index_file))
        return FileResponse(str(frontend_dist / "index.html"))

    # Start server in a thread
    import uvicorn
    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="info")
    server = uvicorn.Server(config)

    print(f"Starting Adler Graph Reader UI...")
    print(f"Backend API: http://localhost:{port}/api")
    print(f"Frontend UI: http://localhost:{port}")
    print("\nPress Ctrl+C to stop")

    if open_browser:
        # Open browser after a short delay
        def open_browser_delayed():
            time.sleep(1.5)
            webbrowser.open(f"http://localhost:{port}")
        threading.Thread(target=open_browser_delayed, daemon=True).start()

    # Run server
    try:
        server.run()
    except KeyboardInterrupt:
        print("\nShutting down...")


def cmd_api(host: str = "0.0.0.0", port: int = 8000, reload: bool = False) -> None:
    """Start the FastAPI server."""
    import uvicorn
    from .api.main import app

    print(f"Starting API server at http://{host}:{port}")
    print(f"API docs available at http://{host}:{port}/docs")

    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=reload,
    )


def main() -> int:
    """Main entry point."""
    args = parse_args()

    # Set global language configuration
    if hasattr(args, "language"):
        set_language(args.language)
        config = get_config()
        print(f"Language: {config.get_language_name()}")

    if args.command == "init-db":
        database.init_database()
        print("Database initialized.")
        return 0

    if args.command == "ingest":
        if args.batch:
            # Batch ingest
            batch_dir = args.batch
            if not batch_dir.is_dir():
                print(f"Error: {batch_dir} is not a directory")
                return 1
            supported_exts = (".pdf", ".epub")
            files = sorted(
                [f for f in batch_dir.iterdir() if f.suffix.lower() in supported_exts]
            )
            if not files:
                print(f"No PDF/EPUB files found in {batch_dir}")
                return 1
            print(f"Found {len(files)} files to ingest")
            for f in files:
                print(f"\n--- Ingesting: {f.name} ---")
                doc_id = cmd_ingest(f)
                print(f"Done: {doc_id}")
            print(f"\nBatch ingestion complete: {len(files)} files processed.")
        else:
            if not args.file:
                print("Error: Please provide a file or use --batch")
                return 1
            cmd_ingest(args.file, args.title)
            print("Ingestion complete.")
        return 0

    if args.command == "analyze":
        cmd_analyze(args.file, args.output)
        return 0

    if args.command == "search":
        cmd_search(args.query, args.document)
        return 0

    if args.command == "extract-themes":
        cmd_extract_themes(args.document)
        return 0

    if args.command == "extract-concepts":
        cmd_extract_concepts(args.document, args.theme_ids)
        return 0

    if args.command == "extract-relations":
        cmd_extract_relations(args.document)
        return 0

    if args.command == "build-graph":
        if args.all:
            # Build graph for all documents without concepts
            conn = database.get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT DISTINCT document_id FROM document_tree
                WHERE document_id NOT IN (SELECT DISTINCT document_id FROM concepts)
                ORDER BY document_id
                """
            )
            doc_ids = [row[0] for row in cursor.fetchall()]
            conn.close()
            if not doc_ids:
                print("No documents found without existing concepts.")
                return 0
            print(f"Found {len(doc_ids)} documents without concepts")
            for doc_id in doc_ids:
                print(f"\n=== Building graph for: {doc_id} ===")
                cmd_build_graph(None, doc_id)
            print(f"\nBatch build-graph complete: {len(doc_ids)} documents processed.")
        else:
            cmd_build_graph(args.file, args.document)
        return 0

    if args.command == "process":
        cmd_process(args.file, args.batch, args.process_all, args.title)
        return 0

    if args.command == "graph":
        cmd_graph(args.document, args.format)
        return 0

    if args.command == "export-graph":
        # Handle both --format and --formats arguments
        formats = args.formats if args.formats else [args.format]
        cmd_export_graph(args.document, args.output, formats, args.layout)
        return 0

    if args.command == "qa":
        cmd_qa(args.question, args.document, args.session)
        return 0

    if args.command == "ui":
        cmd_ui(args.port, args.browser)
        return 0

    if args.command == "api":
        cmd_api(args.host, args.port, args.reload)
        return 0

    print("Usage: adler-graph-reader <command>")
    return 1


if __name__ == "__main__":
    sys.exit(main())
