"""
Database module: SQLite with FTS5 and sqlite-vec for hybrid search.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Optional

import sqlite_vec


DB_PATH = Path("knowledge.sqlite")
VEC_EXTENSION = Path(sqlite_vec.__file__).parent / "vec0.dylib"
EMBEDDING_DIM = 768  # nomic-embed-text-v1.5 output dimension


def get_connection() -> sqlite3.Connection:
    """Create a database connection with foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_admin_connection() -> sqlite3.Connection:
    """Create a database connection with extension loading enabled (admin only)."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.enable_load_extension(True)
    conn.execute(f"SELECT load_extension('{VEC_EXTENSION}')")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_database(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """
    Initialize the knowledge database with all required tables.

    Tables:
    - document_tree: stores tree nodes (chapters/chunks) with parent_id tracking
    - fts_chunks: FTS5 virtual table for BM25 full-text search
    - vec_chunks: sqlite-vec virtual table for semantic vector search
    """
    conn = get_admin_connection()
    cursor = conn.cursor()

    # 1. document_tree: hierarchical structure for context expansion
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS document_tree (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id INTEGER REFERENCES document_tree(id),
            document_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('chapter', 'chunk')),
            content TEXT NOT NULL,
            page_number INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 2. fts_chunks: FTS5 virtual table for full-text search
    # Using independent FTS5 table (not external content) for better compatibility
    cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
            content,
            document_id UNINDEXED,
            tree_id UNINDEXED
        )
    """)

    # Triggers to keep FTS in sync with document_tree
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS document_tree_ai AFTER INSERT ON document_tree BEGIN
            INSERT INTO fts_chunks(rowid, content, document_id, tree_id)
            VALUES (new.id, new.content, new.document_id, new.id);
        END
    """)

    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS document_tree_ad AFTER DELETE ON document_tree BEGIN
            DELETE FROM fts_chunks WHERE rowid = old.id;
        END
    """)

    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS document_tree_au AFTER UPDATE ON document_tree BEGIN
            DELETE FROM fts_chunks WHERE rowid = old.id;
            INSERT INTO fts_chunks(rowid, content, document_id, tree_id)
            VALUES (new.id, new.content, new.document_id, new.id);
        END
    """)

    # 3. vec_chunks: sqlite-vec for semantic search
    cursor.execute(f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            tree_id INTEGER PRIMARY KEY,
            embedding FLOAT[{EMBEDDING_DIM}]
        )
    """)

    # Indexes for faster queries
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_document_tree_parent
        ON document_tree(parent_id)
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_document_tree_document
        ON document_tree(document_id)
    """)

    conn.commit()

    # Initialize graph tables
    init_graph_tables(conn)

    return conn


def insert_chunk(
    conn: sqlite3.Connection,
    content: str,
    document_id: str,
    chunk_type: str,
    parent_id: Optional[int] = None,
    page_number: Optional[int] = None,
) -> int:
    """Insert a chunk into document_tree. Returns the new row ID."""
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO document_tree (parent_id, document_id, type, content, page_number)
        VALUES (?, ?, ?, ?, ?)
        """,
        (parent_id, document_id, chunk_type, content, page_number),
    )
    conn.commit()
    return cursor.lastrowid


def insert_embedding(
    conn: sqlite3.Connection, tree_id: int, embedding: list[float]
) -> None:
    """Insert a vector embedding for a chunk."""
    import json

    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO vec_chunks (tree_id, embedding) VALUES (?, ?)",
        (tree_id, json.dumps(embedding)),
    )
    conn.commit()


def _escape_fts5(query: str) -> str:
    """Escape special FTS5 characters and prepare query."""
    # Remove or escape special FTS5 characters
    import re

    # Wrap in quotes for phrase matching if multiple words
    if " " in query:
        # Escape special chars and wrap as phrase
        query = re.sub(r'["\(\)\-\+\:\^\*\?]', " ", query)
        return f'"{query.strip()}"'
    return query.strip()


def bm25_search(
    conn: sqlite3.Connection,
    query: str,
    document_id: Optional[str] = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Perform BM25 full-text search using FTS5."""
    # Handle empty query
    if not query or not query.strip():
        return []

    # Escape the query for FTS5
    query = _escape_fts5(query)
    cursor = conn.cursor()

    if document_id:
        cursor.execute(
            """
            SELECT tree_id, content, bm25(fts_chunks) as rank
            FROM fts_chunks
            WHERE fts_chunks MATCH ?
            AND document_id = ?
            ORDER BY rank
            LIMIT ?
            """,
            (query, document_id, limit),
        )
    else:
        cursor.execute(
            """
            SELECT tree_id, content, bm25(fts_chunks) as rank
            FROM fts_chunks
            WHERE fts_chunks MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (query, limit),
        )

    return [
        {"tree_id": row[0], "content": row[1], "bm25_rank": abs(row[2])}
        for row in cursor.fetchall()
    ]


def vector_search(
    conn: sqlite3.Connection,
    query_embedding: list[float],
    document_id: Optional[str] = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Perform semantic vector search using sqlite-vec."""
    import json

    cursor = conn.cursor()
    # Convert embedding to JSON string for sqlite-vec
    embedding_json = json.dumps(query_embedding)

    if document_id:
        cursor.execute(
            """
            SELECT v.tree_id, d.content, d.page_number, vec_distance_cosine(v.embedding, ?) as distance
            FROM vec_chunks v
            JOIN document_tree d ON d.id = v.tree_id
            WHERE d.document_id = ?
            ORDER BY distance
            LIMIT ?
            """,
            (embedding_json, document_id, limit),
        )
    else:
        cursor.execute(
            """
            SELECT v.tree_id, d.content, d.page_number, vec_distance_cosine(v.embedding, ?) as distance
            FROM vec_chunks v
            JOIN document_tree d ON d.id = v.tree_id
            ORDER BY distance
            LIMIT ?
            """,
            (embedding_json, limit),
        )

    return [
        {
            "tree_id": row[0],
            "content": row[1],
            "page_number": row[2],
            "vector_distance": row[3],
        }
        for row in cursor.fetchall()
    ]


def get_sibling_chunks(
    conn: sqlite3.Connection,
    tree_id: int,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """
    Get sibling chunks for context expansion.
    Retrieves chunks before and after the given chunk within the same parent.
    """
    cursor = conn.cursor()

    cursor.execute(
        "SELECT parent_id FROM document_tree WHERE id = ?",
        (tree_id,),
    )
    row = cursor.fetchone()
    if not row or row[0] is None:
        return []

    parent_id = row[0]

    cursor.execute(
        """
        SELECT id, content, page_number
        FROM document_tree
        WHERE parent_id = ?
        ORDER BY id
        """,
        (parent_id,),
    )

    siblings = cursor.fetchall()
    target_idx = next((i for i, s in enumerate(siblings) if s[0] == tree_id), -1)

    if target_idx == -1:
        return []

    start = max(0, target_idx - limit)
    end = min(len(siblings), target_idx + limit + 1)

    return [
        {"tree_id": s[0], "content": s[1], "page_number": s[2]}
        for s in siblings[start:end]
    ]


def get_ancestors(conn: sqlite3.Connection, tree_id: int) -> list[dict[str, Any]]:
    """Get all ancestor nodes (chapters) for a chunk."""
    cursor = conn.cursor()
    ancestors = []

    current_id = tree_id
    while True:
        cursor.execute(
            "SELECT id, parent_id, type, content FROM document_tree WHERE id = ?",
            (current_id,),
        )
        row = cursor.fetchone()
        if not row:
            break

        ancestors.append(
            {
                "id": row[0],
                "parent_id": row[1],
                "type": row[2],
                "content": row[3],
            }
        )

        if row[1] is None:
            break
        current_id = row[1]

    return ancestors


def get_chunks_by_ids(
    conn: sqlite3.Connection, tree_ids: list[int]
) -> list[dict[str, Any]]:
    """Get multiple chunks by their IDs."""
    cursor = conn.cursor()
    placeholders = ",".join("?" * len(tree_ids))
    cursor.execute(
        f"""
        SELECT id, content, page_number, type
        FROM document_tree
        WHERE id IN ({placeholders})
        """,
        tree_ids,
    )
    return [
        {"tree_id": row[0], "content": row[1], "page_number": row[2], "type": row[3]}
        for row in cursor.fetchall()
    ]


def init_graph_tables(conn: Optional[sqlite3.Connection] = None) -> sqlite3.Connection:
    """
    Initialize knowledge graph tables.

    Tables:
    - themes: Major themes/topics in the document
    - concepts: Key concepts with definitions and examples
    - concept_relations: Relationships between concepts
    - qa_tracking: Question-answer tracking for interactive QA
    """
    should_close = False
    if conn is None:
        conn = get_admin_connection()
        should_close = True

    cursor = conn.cursor()

    # 1. themes: Major themes/topics
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS themes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            importance_score REAL DEFAULT 0.5,
            source_chunks TEXT,  -- JSON array of chunk IDs
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 2. concepts: Key concepts with definitions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS concepts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL,
            theme_id INTEGER REFERENCES themes(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            definition TEXT NOT NULL,
            explanation TEXT,  -- Detailed explanation
            examples TEXT,  -- JSON array
            importance_score REAL DEFAULT 0.5,
            category TEXT DEFAULT 'concept',  -- concept, principle, method, tool, person, event
            source_chunk_ids TEXT,  -- JSON array
            embedding BLOB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 3. concept_relations: Relationships between concepts
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS concept_relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL,
            source_concept_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
            target_concept_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
            relation_type TEXT,  -- broader_than, narrower_than, related_to, similar_to, prerequisite_for, causes, contradicts, supports
            strength REAL DEFAULT 0.5,
            evidence TEXT,
            explanation TEXT,  -- Explanation of the relationship
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 4. qa_tracking: Question-answer session tracking
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS qa_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            question TEXT NOT NULL,
            focus_concept_id INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
            context TEXT,
            answer TEXT,
            cited_concept_ids TEXT,  -- JSON array
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Indexes
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_themes_document ON themes(document_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_concepts_document ON concepts(document_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_concepts_theme ON concepts(theme_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_relations_source ON concept_relations(source_concept_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_relations_target ON concept_relations(target_concept_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_qa_session ON qa_tracking(session_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_qa_document ON qa_tracking(document_id)"
    )

    conn.commit()

    if should_close:
        conn.close()

    return conn


# ===== Graph CRUD Operations =====


def insert_theme(
    conn: sqlite3.Connection,
    document_id: str,
    name: str,
    description: str | None = None,
    importance_score: float = 0.5,
    source_chunks: list[int] | None = None,
) -> int:
    """Insert a theme. Returns the new row ID."""
    import json

    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO themes (document_id, name, description, importance_score, source_chunks)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            document_id,
            name,
            description,
            importance_score,
            json.dumps(source_chunks or []),
        ),
    )
    conn.commit()
    return cursor.lastrowid


def get_themes(conn: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
    """Get all themes for a document."""
    import json

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, document_id, name, description, importance_score, source_chunks, created_at
        FROM themes WHERE document_id = ? ORDER BY importance_score DESC
        """,
        (document_id,),
    )
    return [
        {
            "id": row[0],
            "document_id": row[1],
            "name": row[2],
            "description": row[3],
            "importance_score": row[4],
            "source_chunks": json.loads(row[5]) if row[5] else [],
            "created_at": row[6],
        }
        for row in cursor.fetchall()
    ]


def insert_concept(
    conn: sqlite3.Connection,
    document_id: str,
    name: str,
    definition: str,
    theme_id: int | None = None,
    examples: list[str] | None = None,
    importance_score: float = 0.5,
    source_chunk_ids: list[int] | None = None,
    embedding: list[float] | None = None,
    explanation: str | None = None,
    category: str = "concept",
) -> int:
    """Insert a concept. Returns the new row ID. Skips if concept with same name already exists."""
    import json

    cursor = conn.cursor()

    # Check if concept with same name already exists for this document
    cursor.execute(
        "SELECT id FROM concepts WHERE document_id = ? AND name = ?",
        (document_id, name),
    )
    existing = cursor.fetchone()
    if existing:
        # Concept already exists, skip insertion
        return existing[0]

    embedding_json = json.dumps(embedding) if embedding else None
    cursor.execute(
        """
        INSERT INTO concepts (document_id, theme_id, name, definition, explanation, examples, importance_score, category, source_chunk_ids, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            document_id,
            theme_id,
            name,
            definition,
            explanation,
            json.dumps(examples or []),
            importance_score,
            category,
            json.dumps(source_chunk_ids or []),
            embedding_json,
        ),
    )
    conn.commit()
    return cursor.lastrowid


def get_concepts(conn: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
    """Get all concepts for a document."""
    import json

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, document_id, theme_id, name, definition, explanation, examples, importance_score, category, source_chunk_ids, created_at
        FROM concepts WHERE document_id = ? ORDER BY importance_score DESC
        """,
        (document_id,),
    )
    return [
        {
            "id": row[0],
            "document_id": row[1],
            "theme_id": row[2],
            "name": row[3],
            "definition": row[4],
            "explanation": row[5],
            "examples": json.loads(row[6]) if row[6] else [],
            "importance_score": row[7],
            "category": row[8],
            "source_chunk_ids": json.loads(row[9]) if row[9] else [],
            "created_at": row[10],
        }
        for row in cursor.fetchall()
    ]


def get_concept_by_id(
    conn: sqlite3.Connection, concept_id: int
) -> dict[str, Any] | None:
    """Get a single concept by ID."""
    import json

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, document_id, theme_id, name, definition, explanation, examples, importance_score, category, source_chunk_ids, embedding, created_at
        FROM concepts WHERE id = ?
        """,
        (concept_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "document_id": row[1],
        "theme_id": row[2],
        "name": row[3],
        "definition": row[4],
        "explanation": row[5],
        "examples": json.loads(row[6]) if row[6] else [],
        "importance_score": row[7],
        "category": row[8],
        "source_chunk_ids": json.loads(row[9]) if row[9] else [],
        "embedding": json.loads(row[10]) if row[10] else None,
        "created_at": row[11],
    }


def search_concepts_by_embedding(
    conn: sqlite3.Connection,
    query_embedding: list[float],
    document_id: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Search concepts by embedding similarity."""
    import json

    cursor = conn.cursor()
    embedding_json = json.dumps(query_embedding)

    cursor.execute(
        """
        SELECT c.id, c.document_id, c.theme_id, c.name, c.definition, c.explanation, c.examples,
               c.importance_score, c.category, c.source_chunk_ids, vec_distance_cosine(c.embedding, ?) as distance
        FROM concepts c
        WHERE c.document_id = ? AND c.embedding IS NOT NULL
        ORDER BY distance
        LIMIT ?
        """,
        (embedding_json, document_id, limit),
    )

    return [
        {
            "id": row[0],
            "document_id": row[1],
            "theme_id": row[2],
            "name": row[3],
            "definition": row[4],
            "explanation": row[5],
            "examples": json.loads(row[6]) if row[6] else [],
            "importance_score": row[7],
            "category": row[8],
            "source_chunk_ids": json.loads(row[9]) if row[9] else [],
            "distance": row[10],
        }
        for row in cursor.fetchall()
    ]


def insert_relation(
    conn: sqlite3.Connection,
    document_id: str,
    source_concept_id: int,
    target_concept_id: int,
    relation_type: str,
    strength: float = 0.5,
    evidence: str | None = None,
    explanation: str | None = None,
) -> int:
    """Insert a concept relation. Returns the new row ID."""
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO concept_relations (document_id, source_concept_id, target_concept_id, relation_type, strength, evidence, explanation)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            document_id,
            source_concept_id,
            target_concept_id,
            relation_type,
            strength,
            evidence,
            explanation,
        ),
    )
    conn.commit()
    return cursor.lastrowid


def get_relations(conn: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
    """Get all concept relations for a document."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, document_id, source_concept_id, target_concept_id, relation_type, strength, evidence, explanation, created_at
        FROM concept_relations WHERE document_id = ?
        """,
        (document_id,),
    )
    return [
        {
            "id": row[0],
            "document_id": row[1],
            "source_concept_id": row[2],
            "target_concept_id": row[3],
            "relation_type": row[4],
            "strength": row[5],
            "evidence": row[6],
            "explanation": row[7],
            "created_at": row[8],
        }
        for row in cursor.fetchall()
    ]


def get_concept_relations(
    conn: sqlite3.Connection, concept_id: int
) -> list[dict[str, Any]]:
    """Get all relations for a specific concept."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, document_id, source_concept_id, target_concept_id, relation_type, strength, evidence, explanation, created_at
        FROM concept_relations
        WHERE source_concept_id = ? OR target_concept_id = ?
        """,
        (concept_id, concept_id),
    )
    return [
        {
            "id": row[0],
            "document_id": row[1],
            "source_concept_id": row[2],
            "target_concept_id": row[3],
            "relation_type": row[4],
            "strength": row[5],
            "evidence": row[6],
            "explanation": row[7],
            "created_at": row[8],
        }
        for row in cursor.fetchall()
    ]


def insert_qa(
    conn: sqlite3.Connection,
    document_id: str,
    session_id: str,
    question: str,
    focus_concept_id: int | None = None,
    context: str | None = None,
    answer: str | None = None,
    cited_concept_ids: list[int] | None = None,
) -> int:
    """Insert a QA record. Returns the new row ID."""
    import json

    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO qa_tracking (document_id, session_id, question, focus_concept_id, context, answer, cited_concept_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            document_id,
            session_id,
            question,
            focus_concept_id,
            context,
            answer,
            json.dumps(cited_concept_ids or []),
        ),
    )
    conn.commit()
    return cursor.lastrowid


def get_qa_history(conn: sqlite3.Connection, session_id: str) -> list[dict[str, Any]]:
    """Get QA history for a session."""
    import json

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, document_id, session_id, question, focus_concept_id, context, answer, cited_concept_ids, created_at
        FROM qa_tracking WHERE session_id = ? ORDER BY created_at
        """,
        (session_id,),
    )
    return [
        {
            "id": row[0],
            "document_id": row[1],
            "session_id": row[2],
            "question": row[3],
            "focus_concept_id": row[4],
            "context": row[5],
            "answer": row[6],
            "cited_concept_ids": json.loads(row[7]) if row[7] else [],
            "created_at": row[8],
        }
        for row in cursor.fetchall()
    ]


def get_document_graph(conn: sqlite3.Connection, document_id: str) -> dict[str, Any]:
    """Get complete graph data for a document."""
    return {
        "themes": get_themes(conn, document_id),
        "concepts": get_concepts(conn, document_id),
        "relations": get_relations(conn, document_id),
    }


if __name__ == "__main__":
    conn = init_database()
    print(f"Database initialized at: {DB_PATH}")

    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    print(f"Tables: {[t[0] for t in tables]}")

    conn.close()
