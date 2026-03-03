#!/usr/bin/env python3
"""
批量提取概念的脚本 - 绕过build-graph，直接调用extractor
"""

import sys

sys.path.insert(0, "src")

from adler_graph_reader import database
from adler_graph_reader.knowledge.graph import KnowledgeGraph


def main():
    document_id = "Designing Machine Learning Systems"

    print("=" * 60)
    print(f"批量提取概念: {document_id}")
    print("=" * 60)

    # 检查当前状态
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT COUNT(*) FROM concepts WHERE document_id = ?", (document_id,)
    )
    concept_count = cursor.fetchone()[0]

    cursor.execute(
        "SELECT COUNT(*) FROM concept_relations WHERE document_id = ?", (document_id,)
    )
    relation_count = cursor.fetchone()[0]

    print("\n当前状态:")
    print(f"  概念: {concept_count}")
    print(f"  关系: {relation_count}")

    # 运行多次提取
    target_concepts = 50
    iterations = 0
    max_iterations = 5

    while concept_count < target_concepts and iterations < max_iterations:
        iterations += 1
        print(f"\n{'=' * 60}")
        print(f"第 {iterations} 轮提取...")
        print("=" * 60)

        try:
            # 提取主题（已有的会跳过）
            graph = KnowledgeGraph(conn)
            themes = graph.extract_themes(document_id)
            print(f"提取了 {len(themes)} 个主题")

            # 提取概念
            theme_ids = [t.id for t in themes if t.id]
            concepts = graph.extract_concepts(document_id, theme_ids)
            print(f"提取了 {len(concepts)} 个新概念")

            # 提取关系
            relations = graph.extract_relations(document_id)
            print(f"提取了 {len(relations)} 个新关系")

            graph.close()

            # 更新计数
            cursor.execute(
                "SELECT COUNT(*) FROM concepts WHERE document_id = ?", (document_id,)
            )
            concept_count = cursor.fetchone()[0]

            cursor.execute(
                "SELECT COUNT(*) FROM concept_relations WHERE document_id = ?",
                (document_id,),
            )
            relation_count = cursor.fetchone()[0]

            print("\n更新后状态:")
            print(f"  概念: {concept_count}")
            print(f"  关系: {relation_count}")

        except Exception as e:
            print(f"错误: {e}")
            import traceback

            traceback.print_exc()
            continue

    conn.close()

    print("\n" + "=" * 60)
    print("批量提取完成!")
    print(f"最终概念数: {concept_count}")
    print(f"最终关系数: {relation_count}")
    print("=" * 60)


if __name__ == "__main__":
    main()
