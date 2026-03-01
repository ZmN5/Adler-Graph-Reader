"""
Knowledge extractors for themes, concepts, and relations.
"""

import sqlite3
from typing import Any, Optional

from ..llm import OllamaClient, get_default_client
from ..llm.models import (
    ConceptExtractionWithExamples,
    ConceptRelationExtraction,
    ThemeExtraction,
)
from .graph_models import ConceptModel, RelationModel, ThemeModel


class ThemeExtractor:
    """Extract major themes from a document using Map-Reduce."""

    def __init__(self, client: Optional[OllamaClient] = None):
        self.client = client or get_default_client()

    def extract(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        max_themes: int = 5,
    ) -> list[ThemeModel]:
        """
        Extract major themes from document chapters.

        Uses Map-Reduce:
        - Map: Extract themes from each chapter
        - Reduce: Combine and rank themes
        """
        # Get a sample of content for theme extraction
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT content FROM document_tree
            WHERE document_id = ? AND type = 'chapter'
            ORDER BY id
            LIMIT 10
            """,
            (document_id,),
        )
        contents = [row[0] for row in cursor.fetchall()]
        
        if not contents:
            cursor.execute(
                """
                SELECT content FROM document_tree
                WHERE document_id = ?
                ORDER BY id
                LIMIT 5
                """,
                (document_id,),
            )
            contents = [row[0] for row in cursor.fetchall()]
        
        # Combine content for theme extraction
        combined_content = "\n\n---\n\n".join([c[:2000] for c in contents[:5]])
        
        prompt = f"""从以下书籍内容中提取{max_themes}个主要主题：

{combined_content}

请为每个主题提供：
1. 主题名称（简洁的关键词）
2. 主题描述（一句话）
3. 重要性评分（0-1）

请严格按照格式输出。"""

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=ThemeExtraction,
                system="你是一个主题提取专家，擅长从文本中识别主要主题。",
                temperature=0.3,
            )
            return [
                ThemeModel(
                    document_id=document_id,
                    name=t.name,
                    description=t.description,
                    importance_score=t.importance_score,
                    source_chunks=[],
                )
                for t in result.themes
            ]
        except Exception as e:
            print(f"Warning: Failed to extract themes: {e}")
            return []


class ConceptExtractor:
    """Extract concepts with definitions and examples from document."""

    def __init__(self, client: Optional[OllamaClient] = None):
        self.client = client or get_default_client()

    def extract(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        theme_ids: Optional[list[int]] = None,
        max_concepts: int = 20,
    ) -> list[ConceptModel]:
        """
        Extract concepts from document using hybrid search.
        """
        cursor = conn.cursor()

        # Get key terms from document (first chapters)
        cursor.execute(
            """
            SELECT content FROM document_tree
            WHERE document_id = ? AND type = 'chapter'
            ORDER BY id
            LIMIT 5
            """,
            (document_id,),
        )
        chapters = [row[0] for row in cursor.fetchall()]

        if not chapters:
            cursor.execute(
                """
                SELECT content FROM document_tree
                WHERE document_id = ?
                ORDER BY id
                LIMIT 10
                """,
                (document_id,),
            )
            chapters = [row[0] for row in cursor.fetchall()]

        # Identify potential concepts
        prompt = f"""从以下文本中识别核心概念（关键词/术语），这些概念应该是书中的重要术语：

{chr(10).join([ch[:1000] for ch in chapters[:3]])}

请列出20-30个核心概念名词/术语，按重要性排序。每行一个概念。"""

        try:
            concept_names = self.client.generate(
                prompt,
                system="你是一个概念识别专家，擅长识别文本中的关键术语和概念。",
                temperature=0.3,
            ).strip().split("\n")
            concept_names = [c.strip().lstrip("0123456789.-* ") for c in concept_names if c.strip()]
        except Exception as e:
            print(f"Warning: Failed to identify concepts: {e}")
            concept_names = []

        # Extract definition and examples for each concept
        concepts = []
        for name in concept_names[:max_concepts]:
            try:
                # Search for context
                cursor.execute(
                    """
                    SELECT d.id, d.content FROM document_tree d
                    WHERE d.document_id = ? AND d.content LIKE ?
                    ORDER BY d.id
                    LIMIT 3
                    """,
                    (document_id, f"%{name}%"),
                )
                context_rows = cursor.fetchall()

                if not context_rows:
                    continue

                context = "\n\n".join([
                    f"[Chunk {row[0]}]: {row[1][:500]}"
                    for row in context_rows
                ])
                chunk_ids = [row[0] for row in context_rows]

                # Extract concept details
                prompt = f"""从以下上下文中提取关于"{name}"的概念信息：

{context}

请提供：
1. 概念定义（一句话）
2. 2-3个例子
3. 重要性评分（0-1）

请严格按照格式输出。"""

                result = self.client.generate_structured(
                    prompt,
                    response_model=ConceptExtractionWithExamples,
                    system="你是一个知识提取专家，擅长提取概念的定义和例子。",
                    temperature=0.5,
                )

                if result.concepts:
                    concept = result.concepts[0]
                    # Generate embedding for the concept
                    embedding = self.client.embed(f"{concept.name}: {concept.definition}")

                    concepts.append(ConceptModel(
                        document_id=document_id,
                        theme_id=theme_ids[0] if theme_ids else None,
                        name=concept.name,
                        definition=concept.definition,
                        examples=concept.examples,
                        importance_score=concept.importance_score,
                        source_chunk_ids=chunk_ids,
                        embedding=embedding,
                    ))
            except Exception as e:
                print(f"Warning: Failed to extract concept {name}: {e}")
                continue

        return concepts


class RelationExtractor:
    """Extract relationships between concepts."""

    def __init__(self, client: Optional[OllamaClient] = None):
        self.client = client or get_default_client()

    def extract(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        concepts: list[ConceptModel],
        max_relations: int = 30,
    ) -> list[RelationModel]:
        """
        Extract relationships between concepts.
        """
        if len(concepts) < 2:
            return []

        # Build concept context
        concept_list = "\n".join([
            f"- {c.name}: {c.definition[:100]}..."
            for c in concepts[:20]
        ])

        # Get context chunks for these concepts
        cursor = conn.cursor()
        all_chunk_ids = set()
        for c in concepts[:20]:
            all_chunk_ids.update(c.source_chunk_ids or [])

        if not all_chunk_ids:
            return []

        placeholders = ",".join("?" * len(all_chunk_ids))
        cursor.execute(
            f"""
            SELECT content FROM document_tree
            WHERE id IN ({placeholders})
            """,
            list(all_chunk_ids),
        )
        context = "\n\n".join([row[0][:500] for row in cursor.fetchall()])

        # Extract relations
        prompt = f"""请分析以下概念列表，识别它们之间的关系：

概念列表：
{concept_list}

上下文参考：
{context[:3000]}

请识别概念之间的关系，关系类型包括：
- relates_to: 相关关系
- similar_to: 相似关系
- broader_than: 包含/广义关系
- prerequisite_for: 前置/基础关系
- supports: 支持关系
- contradicts: 矛盾关系

请输出最多{max_relations}个最重要的关系。"""

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=ConceptRelationExtraction,
                system="你是一个关系分析专家，擅长识别概念之间的逻辑关系。",
                temperature=0.5,
            )

            # Map concept names to IDs
            concept_map = {c.name: c.id for c in concepts}

            relations = []
            for rel in result.relations:
                source_id = concept_map.get(rel.source_concept)
                target_id = concept_map.get(rel.target_concept)

                if source_id and target_id and source_id != target_id:
                    relations.append(RelationModel(
                        document_id=document_id,
                        source_concept_id=source_id,
                        target_concept_id=target_id,
                        relation_type=rel.relation_type,
                        strength=rel.strength,
                        evidence=rel.evidence,
                    ))

            return relations[:max_relations]
        except Exception as e:
            print(f"Warning: Failed to extract relations: {e}")
            return []


class QAExtractor:
    """Answer questions about the document using the knowledge graph."""

    def __init__(self, client: Optional[OllamaClient] = None):
        self.client = client or get_default_client()

    def answer(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        question: str,
        session_id: str,
    ) -> dict[str, Any]:
        """
        Answer a question about the document using concepts and context.
        """
        from ..llm.models import QAResponse
        from ..database import search_concepts_by_embedding, get_concepts, get_chunks_by_ids

        # Get relevant concepts using semantic search
        question_embedding = self.client.embed(question)

        # Search by embedding
        relevant_concepts = search_concepts_by_embedding(
            conn, question_embedding, document_id, limit=5
        )

        # Also get top concepts by importance
        all_concepts = get_concepts(conn, document_id)
        important_concepts = all_concepts[:10]

        # Combine and dedupe
        concept_ids = set()
        combined = []
        for c in relevant_concepts:
            if c["id"] not in concept_ids:
                concept_ids.add(c["id"])
                combined.append(c)
        for c in important_concepts:
            if c["id"] not in concept_ids:
                concept_ids.add(c["id"])
                combined.append(c)

        # Build context from concepts and their source chunks
        concept_map = {c["id"]: c for c in combined}
        all_chunk_ids = []
        for c in combined:
            all_chunk_ids.extend(c.get("source_chunk_ids", []))

        if all_chunk_ids:
            chunks = get_chunks_by_ids(conn, list(set(all_chunk_ids))[:10])
            context = "\n\n".join([
                f"[来源]: {c['content'][:400]}"
                for c in chunks
            ])
        else:
            context = "\n\n".join([
                f"概念: {c['name']}\n定义: {c['definition']}"
                for c in combined[:5]
            ])

        # Generate answer
        prompt = f"""基于以下上下文信息，请回答用户的问题。

问题: {question}

相关概念和上下文:
{context}

请提供：
1. 答案
2. 引用的概念名称列表
3. 置信度评分（0-1）

如果无法从上下文中找到答案，请明确说明。"""

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=QAResponse,
                system="你是一个问答专家，擅长基于给定的上下文回答问题。请只使用提供的上下文信息，不要编造。",
                temperature=0.5,
            )

            # Find concept IDs from names
            cited_ids = []
            for name in result.cited_concepts:
                for c in combined:
                    if c["name"] == name:
                        cited_ids.append(c["id"])
                        break

            return {
                "answer": result.answer,
                "cited_concept_ids": cited_ids,
                "confidence": result.confidence,
                "question": question,
                "session_id": session_id,
            }
        except Exception as e:
            print(f"Warning: Failed to generate answer: {e}")
            return {
                "answer": "抱歉，无法基于当前知识图谱回答这个问题。",
                "cited_concept_ids": [],
                "confidence": 0.0,
                "question": question,
                "session_id": session_id,
            }
