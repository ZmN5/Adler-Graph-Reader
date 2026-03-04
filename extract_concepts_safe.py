#!/usr/bin/env python3
"""Safe concept extraction with error recovery."""

import sys
import time
sys.path.insert(0, 'src')

from adler_graph_reader.knowledge.graph import KnowledgeGraph
from adler_graph_reader.database import get_admin_connection

def main():
    document_id = 'Designing Machine Learning Systems'

    print('=== Connecting to database ===')
    conn = get_admin_connection()
    graph = KnowledgeGraph(conn)

    # Check current state
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM concepts WHERE document_id = ?", (document_id,))
    current_count = cursor.fetchone()[0]
    print(f"Current concepts: {current_count}")

    if current_count >= 150:
        print(f"Already have {current_count} concepts. Skipping extraction.")
        graph.close()
        return

    print('=== Extracting themes ===')
    try:
        themes = graph.extract_themes(document_id)
        print(f'Extracted {len(themes)} themes')
    except Exception as e:
        print(f'Theme extraction failed: {e}')
        themes = []

    print('=== Extracting concepts (this may take a while) ===')
    theme_ids = [t.id for t in themes if t.id] if themes else None

    max_retries = 3
    for attempt in range(max_retries):
        try:
            concepts = graph.extract_concepts(document_id, theme_ids)
            print(f'Extracted {len(concepts)} concepts')
            break
        except Exception as e:
            print(f'Concept extraction failed (attempt {attempt + 1}/{max_retries}): {e}')
            if attempt < max_retries - 1:
                print('Waiting 10 seconds before retry...')
                time.sleep(10)
            else:
                print('Max retries reached. Skipping concept extraction.')
                concepts = []

    print('=== Extracting relations ===')
    try:
        relations = graph.extract_relations(document_id)
        print(f'Extracted {len(relations)} relations')
    except Exception as e:
        print(f'Relation extraction failed: {e}')

    # Final count
    cursor.execute("SELECT COUNT(*) FROM concepts WHERE document_id = ?", (document_id,))
    final_count = cursor.fetchone()[0]
    print(f"\nFinal concept count: {final_count}")

    graph.close()
    print('Done!')

if __name__ == '__main__':
    main()
