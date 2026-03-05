#!/usr/bin/env python3
"""
重建知识图谱关系的专用脚本。
删除现有关系并重新提取，确保关系类型多样化。
"""

import sqlite3
import sys
from pathlib import Path

# 添加 src 到路径
sys.path.insert(0, str(Path(__file__).parent / "src"))

from adler_graph_reader import database
from adler_graph_reader.knowledge.graph import KnowledgeGraph
from adler_graph_reader.knowledge.graph_models import ConceptModel
from adler_graph_reader.knowledge.extractor import RelationExtractor


def rebuild_relations(document_id: str) -> None:
    """删除现有关系并重新提取。"""
    conn = database.get_admin_connection()
    cursor = conn.cursor()

    # 1. 获取当前统计
    cursor.execute("SELECT COUNT(*) FROM concepts WHERE document_id = ?", (document_id,))
    concept_count = cursor.fetchone()[0]

    cursor.execute(
        "SELECT relation_type, COUNT(*) FROM concept_relations WHERE document_id = ? GROUP BY relation_type",
        (document_id,)
    )
    before_stats = cursor.fetchall()

    print(f"文档: {document_id}")
    print(f"概念数量: {concept_count}")
    print(f"\n当前关系分布:")
    for rel_type, count in before_stats:
        print(f"  - {rel_type}: {count}")

    # 2. 删除现有关系
    print(f"\n删除现有关系...")
    cursor.execute("DELETE FROM concept_relations WHERE document_id = ?", (document_id,))
    conn.commit()
    print(f"已删除所有现有关系")

    # 3. 加载所有概念
    print(f"\n加载概念...")
    concepts_data = database.get_concepts(conn, document_id)
    concepts = [
        ConceptModel(
            id=c["id"],
            document_id=c["document_id"],
            theme_id=c.get("theme_id"),
            name=c["name"],
            definition=c["definition"],
            examples=c.get("examples", []),
            importance_score=c.get("importance_score", 0.5),
            category=c.get("category", "concept"),
            source_chunk_ids=c.get("source_chunk_ids", []),
        )
        for c in concepts_data
    ]
    print(f"已加载 {len(concepts)} 个概念")

    # 4. 提取新关系
    print(f"\n开始提取关系...")
    print(f"目标: 至少300个多样化关系")

    extractor = RelationExtractor()

    # 增加批次大小和最大关系数
    max_relations = max(400, len(concepts) * 2)
    print(f"最大关系数: {max_relations}")

    relations = extractor.extract(conn, document_id, concepts, max_relations=max_relations)

    # 5. 存储关系
    print(f"\n存储 {len(relations)} 个关系到数据库...")
    for rel in relations:
        database.insert_relation(
            conn,
            document_id=rel.document_id,
            source_concept_id=rel.source_concept_id,
            target_concept_id=rel.target_concept_id,
            relation_type=rel.relation_type,
            strength=rel.strength,
            evidence=rel.evidence,
            explanation=rel.explanation,
        )

    conn.commit()

    # 6. 验证结果
    cursor.execute(
        "SELECT relation_type, COUNT(*) FROM concept_relations WHERE document_id = ? GROUP BY relation_type ORDER BY COUNT(*) DESC",
        (document_id,)
    )
    after_stats = cursor.fetchall()

    cursor.execute(
        "SELECT COUNT(*) FROM concept_relations WHERE document_id = ?",
        (document_id,)
    )
    total_relations = cursor.fetchone()[0]

    print(f"\n{'='*50}")
    print(f"关系提取完成!")
    print(f"{'='*50}")
    print(f"总关系数: {total_relations}")
    print(f"\n关系类型分布:")
    for rel_type, count in after_stats:
        pct = count / total_relations * 100 if total_relations > 0 else 0
        print(f"  - {rel_type}: {count} ({pct:.1f}%)")

    # 7. 检查是否达标
    print(f"\n{'='*50}")
    if total_relations >= 300:
        print(f"✅ 关系数量达标: {total_relations}/300")
    else:
        print(f"❌ 关系数量不足: {total_relations}/300")

    diverse_types = len(after_stats)
    if diverse_types >= 8:
        print(f"✅ 关系类型丰富: {diverse_types} 种")
    else:
        print(f"⚠️ 关系类型偏少: {diverse_types} 种 (建议≥8)")

    conn.close()
    return total_relations


if __name__ == "__main__":
    # 从数据库中检测文档ID
    conn = database.get_admin_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT document_id FROM concepts LIMIT 1")
    result = cursor.fetchone()
    conn.close()

    if result:
        document_id = result[0]
    else:
        document_id = "Designing Machine Learning Systems"

    print("="*60)
    print("Adler Graph Reader - 关系重建工具")
    print(f"目标文档: {document_id}")
    print("="*60)
    rebuild_relations(document_id)
