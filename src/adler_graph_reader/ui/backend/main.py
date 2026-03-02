"""FastAPI backend for Adler Graph Reader UI."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
from pathlib import Path
from typing import List, Dict, Any

app = FastAPI(title="Adler Graph Reader API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).parent.parent.parent.parent.parent / "knowledge.sqlite"


def get_db() -> sqlite3.Connection:
    """Get database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "database": DB_PATH.exists()}


@app.get("/api/documents")
async def get_documents() -> List[str]:
    """Get all document IDs."""
    conn = get_db()
    cursor = conn.execute("SELECT DISTINCT document_id FROM document_tree")
    docs = [row[0] for row in cursor.fetchall()]
    conn.close()
    return docs


@app.get("/api/graph/{document_id}")
async def get_graph(document_id: str) -> Dict[str, Any]:
    """Get knowledge graph data for a document."""
    conn = get_db()
    
    # Get concepts as nodes
    cursor = conn.execute(
        """
        SELECT id, name, definition, importance_score, category 
        FROM concepts 
        WHERE document_id = ?
        """,
        (document_id,),
    )
    nodes = [
        {
            "id": row["id"],
            "name": row["name"],
            "definition": row["definition"],
            "importance": row["importance_score"],
            "category": row["category"] or "concept",
        }
        for row in cursor.fetchall()
    ]
    
    # Get relations as links
    cursor = conn.execute(
        """
        SELECT source_concept_id, target_concept_id, relation_type, strength
        FROM concept_relations
        WHERE document_id = ?
        """,
        (document_id,),
    )
    links = [
        {
            "source": row["source_concept_id"],
            "target": row["target_concept_id"],
            "type": row["relation_type"],
            "strength": row["strength"],
        }
        for row in cursor.fetchall()
    ]
    
    conn.close()
    
    return {"nodes": nodes, "links": links}


@app.get("/api/stats/{document_id}")
async def get_stats(document_id: str) -> Dict[str, int]:
    """Get document statistics."""
    conn = get_db()
    
    stats = {}
    
    # Chunks count
    cursor = conn.execute(
        "SELECT COUNT(*) FROM document_tree WHERE document_id = ? AND type = 'chunk'",
        (document_id,),
    )
    stats["chunks"] = cursor.fetchone()[0]
    
    # Themes count
    cursor = conn.execute(
        "SELECT COUNT(*) FROM themes WHERE document_id = ?",
        (document_id,),
    )
    stats["themes"] = cursor.fetchone()[0]
    
    # Concepts count
    cursor = conn.execute(
        "SELECT COUNT(*) FROM concepts WHERE document_id = ?",
        (document_id,),
    )
    stats["concepts"] = cursor.fetchone()[0]
    
    # Relations count
    cursor = conn.execute(
        "SELECT COUNT(*) FROM concept_relations WHERE document_id = ?",
        (document_id,),
    )
    stats["relations"] = cursor.fetchone()[0]
    
    conn.close()
    return stats


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
