"""
CLI interface for Adler-Graph-Reader.
"""

import argparse
import subprocess
import sys
from pathlib import Path

from . import database
from .knowledge.models import BookAnalysis, ConceptNode
from .knowledge.graph import KnowledgeGraph, QATracker
from .llm import get_default_client, OllamaClient
from .llm.models import BookSummary, ConceptExtraction
from .output import MarkdownGenerator, ObsidianWriter
from .parser import create_parser, ParsedDocument
from .search import HybridSearchEngine


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="艾德勒图谱阅读器 - Extract knowledge from books"
    )

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # ingest command
    ingest = subparsers.add_parser("ingest", help="Ingest a document")
    ingest.add_argument("file", type=Path, help="PDF or EPUB file")
    ingest.add_argument("--title", help="Override title")

    # analyze command
    analyze = subparsers.add_parser("analyze", help="Analyze a document")
    analyze.add_argument("file", type=Path, help="PDF or EPUB file")
    analyze.add_argument("--output", "-o", type=Path, default=Path("output"))

    # search command
    search = subparsers.add_parser("search", help="Search concepts")
    search.add_argument("query", help="Search query")
    search.add_argument("--document", "-d", required=True, help="Document ID")

    # extract-themes command
    extract_themes = subparsers.add_parser("extract-themes", help="Extract themes from document")
    extract_themes.add_argument("--document", "-d", required=True, help="Document ID")

    # extract-concepts command
    extract_concepts = subparsers.add_parser("extract-concepts", help="Extract concepts from document")
    extract_concepts.add_argument("--document", "-d", required=True, help="Document ID")
    extract_concepts.add_argument("--theme-ids", nargs="*", type=int, help="Theme IDs to associate concepts with")

    # extract-relations command
    extract_relations = subparsers.add_parser("extract-relations", help="Extract concept relations")
    extract_relations.add_argument("--document", "-d", required=True, help="Document ID")

    # build-graph command (complete pipeline)
    build_graph = subparsers.add_parser("build-graph", help="Complete pipeline: ingest + extract themes/concepts/relations")
    build_graph.add_argument("file", type=Path, nargs="?", help="PDF or EPUB file (skip if document already ingested)")
    build_graph.add_argument("--document", "-d", help="Document ID (required if file not provided)")

    # graph command
    graph = subparsers.add_parser("graph", help="View knowledge graph")
    graph.add_argument("--document", "-d", required=True, help="Document ID")
    graph.add_argument("--format", choices=["text", "json", "viz"], default="text", help="Output format")

    # qa command
    qa = subparsers.add_parser("qa", help="Ask questions about the document")
    qa.add_argument("question", help="Question to ask")
    qa.add_argument("--document", "-d", required=True, help="Document ID")
    qa.add_argument("--session", "-s", help="Session ID (creates new if not provided)")

    # init-db command
    subparsers.add_parser("init-db", help="Initialize database")

    # ui command
    ui = subparsers.add_parser("ui", help="Launch web UI")
    ui.add_argument("--port", "-p", type=int, default=8501, help="Port number (default: 8501)")
    ui.add_argument("--browser", "-b", action="store_true", default=True, help="Open browser automatically")
    ui.add_argument("--no-browser", "-n", dest="browser", action="store_false", help="Don't open browser automatically")

    return parser.parse_args()


def cmd_ingest(
    file: Path,
    title: str | None = None,
    llm_client: OllamaClient | None = None,
) -> str:
    """Ingest a document into the database."""
    if llm_client is None:
        llm_client = get_default_client()

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
        context = "\n\n".join([
            r.content + "\n(上下文: " + " ".join(r.context) + ")"
            for r in results
        ])

        # Extract concepts
        extraction = llm_client.generate_structured(
            prompt=f"从以下上下文中提取关于\"{concept_query}\"的概念定义和论证：\n\n{context}",
            response_model=ConceptExtraction,
            system="你是一个知识提取专家。",
        )

        concepts.extend(extraction.concepts)

    conn.close()

    # 4. Generate Markdown
    print("\n=== Stage 4: Markdown Generation ===")
    generator = MarkdownGenerator()

    book_content = generator.generate_book_index(document_id, analysis)
    concept_pages = [
        generator.generate_concept_page(c) for c in concepts
    ]

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
        print(f"{i}. {rel.source_concept_id} --[{rel.relation_type}]--> {rel.target_concept_id}")
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
        cursor.execute("SELECT COUNT(*) FROM document_tree WHERE document_id = ?", (document_id,))
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
    print(f"Knowledge graph built successfully!")
    print(f"  Document: {document_id}")
    print(f"  Themes: {len(themes)}")
    print(f"  Concepts: {len(concepts)}")
    print(f"  Relations: {len(relations)}")
    print("=" * 50)

    print("\nUsage:")
    print(f"  View graph: uv run python main.py graph -d \"{document_id}\"")
    print(f"  Ask questions: uv run python main.py qa \"your question\" -d \"{document_id}\"")

    return document_id


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
    else:
        # Text format
        graph_data = graph.get_graph(document_id)

        print(f"\n=== Themes ({len(graph_data.themes)}) ===\n")
        for theme in graph_data.themes:
            print(f"- {theme.name}: {theme.description}")

        print(f"\n=== Concepts ({len(graph_data.concepts)}) ===\n")
        for concept in graph_data.concepts:
            print(f"- {concept.name}: {concept.definition[:80]}...")

        print(f"\n=== Relations ({len(graph_data.relations)}) ===\n")
        for rel in graph_data.relations:
            print(f"- {rel.source_concept_id} --[{rel.relation_type}]--> {rel.target_concept_id}")

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
            print(f"\n=== Session History ===\n")
            for h in history[-3:]:
                print(f"Q: {h.question}")
                print(f"A: {h.answer[:200]}...")
                print()

    print(f"\n=== Question ===\n{question}\n")

    result = tracker.ask(document_id, question, session_id)

    print(f"=== Answer ===\n")
    print(result["answer"])
    print(f"\nConfidence: {result.get('confidence', 0):.2f}")
    print(f"Cited concepts: {len(result.get('cited_concept_ids', []))}")

    tracker.close()


def cmd_ui(port: int = 8501, open_browser: bool = True):
    """Launch Streamlit web UI."""
    import streamlit.web.cli as stcli
    import os
    
    ui_path = Path(__file__).parent / "ui.py"
    
    if not ui_path.exists():
        print(f"Error: UI file not found at {ui_path}")
        return
    
    # Change to project directory so it finds knowledge.sqlite
    project_dir = Path(__file__).parent.parent.parent
    
    cmd = [
        "streamlit", "run", str(ui_path),
        "--server.port", str(port),
        "--server.headless", "false" if open_browser else "true"
    ]
    
    print(f"Starting UI at http://localhost:{port}")
    print(f"Press Ctrl+C to stop")
    
    os.chdir(project_dir)
    subprocess.run(cmd)


def main() -> int:
    """Main entry point."""
    args = parse_args()

    if args.command == "init-db":
        database.init_database()
        print("Database initialized.")
        return 0

    if args.command == "ingest":
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
        cmd_build_graph(args.file, args.document)
        return 0

    if args.command == "graph":
        cmd_graph(args.document, args.format)
        return 0

    if args.command == "qa":
        cmd_qa(args.question, args.document, args.session)
        return 0

    if args.command == "ui":
        cmd_ui(args.port, args.browser)
        return 0

    print("Usage: adler-graph-reader <command>")
    return 1


if __name__ == "__main__":
    sys.exit(main())
