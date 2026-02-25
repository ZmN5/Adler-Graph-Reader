"""
Adler Graph Reader - Streamlit Web UI

A web interface for exploring knowledge graphs extracted from documents.
"""

import streamlit as st
import sqlite3
from pathlib import Path
from typing import List, Dict, Any, Optional
import graphviz

# Page config
st.set_page_config(
    page_title="Adler Graph Reader",
    page_icon="📚",
    layout="wide"
)

# Constants
DB_PATH = Path(__file__).parent / "knowledge.sqlite"


def get_db_connection() -> sqlite3.Connection:
    """Get database connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_collections() -> List[Dict]:
    """Get all document collections"""
    conn = get_db_connection()
    cursor = conn.execute("SELECT DISTINCT document_id FROM document_tree")
    collections = [row["document_id"] for row in cursor.fetchall()]
    conn.close()
    return collections


def get_document_stats(document_id: str) -> Dict[str, int]:
    """Get statistics for a document"""
    conn = get_db_connection()
    
    # Total chunks
    cursor = conn.execute(
        "SELECT COUNT(*) as count FROM document_tree WHERE document_id = ? AND type = 'chunk'",
        (document_id,)
    )
    chunks = cursor.fetchone()["count"]
    
    # Chapters
    cursor = conn.execute(
        "SELECT COUNT(*) as count FROM document_tree WHERE document_id = ? AND type = 'chapter'",
        (document_id,)
    )
    chapters = cursor.fetchone()["count"]
    
    # Themes
    cursor = conn.execute("SELECT COUNT(*) as count FROM themes WHERE document_id = ?", (document_id,))
    themes = cursor.fetchone()["count"]
    
    # Concepts
    cursor = conn.execute("SELECT COUNT(*) as count FROM concepts WHERE document_id = ?", (document_id,))
    concepts = cursor.fetchone()["count"]
    
    # Relations
    cursor = conn.execute("SELECT COUNT(*) as count FROM concept_relations WHERE document_id = ?", (document_id,))
    relations = cursor.fetchone()["count"]
    
    conn.close()
    
    return {
        "chunks": chunks,
        "chapters": chapters,
        "themes": themes,
        "concepts": concepts,
        "relations": relations
    }


def search_content(document_id: str, query: str, limit: int = 10) -> List[Dict]:
    """Search content using FTS5"""
    conn = get_db_connection()
    
    # Simple LIKE search as fallback
    cursor = conn.execute(
        """
        SELECT content, type, page_number 
        FROM document_tree 
        WHERE document_id = ? AND content LIKE ?
        LIMIT ?
        """,
        (document_id, f"%{query}%", limit)
    )
    
    results = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return results


def get_concepts_with_relations(document_id: str, limit: int = 50) -> List[Dict]:
    """Get concepts and their relations for graph visualization"""
    conn = get_db_connection()
    
    # Get concepts
    cursor = conn.execute(
        """
        SELECT c.id, c.name, c.description, c.type,
               cr.target_id, cr.relation_type, t.name as target_name
        FROM concepts c
        LEFT JOIN concept_relations cr ON c.id = cr.source_id
        LEFT JOIN concepts t ON cr.target_id = t.id
        WHERE c.document_id = ?
        ORDER BY c.name
        LIMIT ?
        """,
        (document_id, limit)
    )
    
    results = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return results


def build_graphvizGraph(concepts: List[Dict]) -> graphviz.Graph:
    """Build Graphviz graph from concepts"""
    dot = graphviz.Digraph(comment="Knowledge Graph")
    dot.attr(rankdir="LR", size="12,8")
    
    # Group by type
    type_colors = {
        "theme": "#FF6B6B",
        "concept": "#4ECDC4", 
        "entity": "#45B7D1",
        "default": "#96CEB4"
    }
    
    # Add nodes
    nodes = set()
    for c in concepts:
        if c["name"] and c["name"] not in nodes:
            color = type_colors.get(c.get("type", "default"), type_colors["default"])
            dot.node(c["name"], color=color, style="filled", fillcolor=color + "40")
            nodes.add(c["name"])
        
        if c.get("target_name") and c["target_name"] not in nodes:
            color = type_colors.get("default", type_colors["default"])
            dot.node(c["target_name"], color=color, style="filled", fillcolor=color + "40")
            nodes.add(c["target_name"])
    
    # Add edges
    for c in concepts:
        if c.get("relation_type") and c["name"] and c.get("target_name"):
            dot.edge(c["name"], c["target_name"], label=c["relation_type"])
    
    return dot


# Sidebar
st.sidebar.title("📚 Adler Graph Reader")
st.sidebar.markdown("---")

# Collection selector
collections = get_collections()
if not collections:
    st.warning("No documents found. Please ingest some documents first.")
    st.stop()

selected_doc = st.sidebar.selectbox("Select Document", collections)

# Stats
st.sidebar.markdown("### 📊 Document Stats")
stats = get_document_stats(selected_doc)

col1, col2 = st.sidebar.columns(2)
col1.metric("Chapters", stats["chapters"])
col2.metric("Chunks", stats["chunks"])

col1, col2 = st.sidebar.columns(2)
col1.metric("Themes", stats["themes"])
col2.metric("Concepts", stats["concepts"])

st.sidebar.metric("Relations", stats["relations"])

# Main content
tab1, tab2, tab3 = st.tabs(["🔍 Search", "🧠 Knowledge Graph", "📖 Content"])

with tab1:
    st.header("Search Content")
    
    query = st.text_input("Search Query", placeholder="Enter keywords...")
    limit = st.slider("Results Limit", 5, 50, 10)
    
    if query:
        results = search_content(selected_doc, query, limit)
        
        st.markdown(f"**{len(results)} results found**")
        
        for i, r in enumerate(results, 1):
            with st.expander(f"Result {i} - {r.get('type', 'chunk').upper()}"):
                st.write(r.get("content", ""))
                if r.get("page_number"):
                    st.caption(f"Page: {r['page_number']}")

with tab2:
    st.header("Knowledge Graph")
    
    graph_limit = st.slider("Concepts to Display", 10, 100, 50)
    
    if st.button("🔄 Refresh Graph"):
        st.rerun()
    
    concepts = get_concepts_with_relations(selected_doc, graph_limit)
    
    if concepts:
        # Build and render graph
        dot = build_graphvizGraph(concepts)
        st.graphviz_chart(dot)
        
        # Show concept details
        st.markdown("### Concept Details")
        
        # Group by name
        concept_details = {}
        for c in concepts:
            name = c.get("name")
            if name and name not in concept_details:
                concept_details[name] = c
        
        for name, details in list(concept_details.items())[:20]:
            with st.expander(f"📌 {name}"):
                st.write(details.get("description", "No description"))
                if details.get("type"):
                    st.caption(f"Type: {details['type']}")
    else:
        st.info("No concepts extracted yet. Run 'build-graph' command to extract concepts.")

with tab3:
    st.header("Browse Content")
    
    conn = get_db_connection()
    
    # Get chapters
    cursor = conn.execute(
        "SELECT id, content FROM document_tree WHERE document_id = ? AND type = 'chapter' LIMIT 20",
        (selected_doc,)
    )
    chapters = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    if chapters:
        for ch in chapters:
            with st.expander(f"📑 {ch['content'][:100]}..."):
                # Get chunks under this chapter
                conn = get_db_connection()
                cursor = conn.execute(
                    "SELECT content FROM document_tree WHERE document_id = ? AND parent_id = ? LIMIT 5",
                    (selected_doc, ch["id"])
                )
                chunks = [row["content"] for row in cursor.fetchall()]
                conn.close()
                
                for chunk in chunks:
                    st.write(chunk[:500] + "..." if len(chunk) > 500 else chunk)
                    st.divider()
    else:
        st.info("No chapter structure found.")


# Footer
st.markdown("---")
st.caption("Adler Graph Reader - Knowledge Extraction from Documents")
