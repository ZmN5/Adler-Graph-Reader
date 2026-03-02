"""
Knowledge extractors for themes, concepts, and relations.
"""

import sqlite3
from typing import Any, Optional

from ..llm import OllamaClient, get_default_client
from ..llm.models import (
    ThemeExtraction,
    EnhancedConceptExtraction,
    EnhancedRelationExtraction,
    EnhancedConcept,
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
        import time

        start_time = time.time()

        cursor = conn.cursor()
        print(f"[ThemeExtractor] Querying database for document: {document_id}")

        cursor.execute(
            """
            SELECT content FROM document_tree
            WHERE document_id = ? AND type = 'chapter'
            ORDER BY id
            LIMIT 5
            """,
            (document_id,),
        )
        contents = [row[0] for row in cursor.fetchall()]
        print(f"[ThemeExtractor] Found {len(contents)} chapters")

        if not contents:
            cursor.execute(
                """
                SELECT content FROM document_tree
                WHERE document_id = ?
                ORDER BY id
                LIMIT 3
                """,
                (document_id,),
            )
            contents = [row[0] for row in cursor.fetchall()]
            print(f"[ThemeExtractor] Fallback: found {len(contents)} chunks")

        # Limit content size to avoid overwhelming the LLM
        combined_content = "\n\n---\n\n".join([c[:1500] for c in contents[:3]])
        content_size = len(combined_content)
        print(f"[ThemeExtractor] Combined content size: {content_size} chars")

        prompt = f"""从以下书籍内容中提取{max_themes}个主要主题：

{combined_content}

请为每个主题提供：
1. 主题名称（简洁的关键词）
2. 主题描述（一句话）
3. 重要性评分（0-1）

请严格按照格式输出。"""

        print(
            f"[ThemeExtractor] Calling LLM... (elapsed: {time.time() - start_time:.1f}s)"
        )

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=ThemeExtraction,
                system="你是一个主题提取专家，擅长从文本中识别主要主题。",
                temperature=0.3,
            )
            elapsed = time.time() - start_time
            print(f"[ThemeExtractor] LLM call completed in {elapsed:.1f}s")
            print(f"[ThemeExtractor] Extracted {len(result.themes)} themes")

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
            elapsed = time.time() - start_time
            print(f"[ThemeExtractor] Error after {elapsed:.1f}s: {e}")
            import traceback

            traceback.print_exc()
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
        max_concepts: int = 30,
    ) -> list[ConceptModel]:
        """
        Extract concepts from document using enhanced extraction.

        Pipeline:
        1. Identify concept candidates from document content
        2. Extract detailed information for each concept (definition, explanation, examples)
        3. Evaluate importance based on frequency and centrality
        """
        cursor = conn.cursor()

        # Get document content for concept extraction
        # Use 'chunk' type since 'chapter' only has titles, not full content
        cursor.execute(
            """
            SELECT id, content FROM document_tree
            WHERE document_id = ? AND type = 'chunk'
            ORDER BY id
            LIMIT 20
            """,
            (document_id,),
        )
        chunks = [(row[0], row[1]) for row in cursor.fetchall()]

        if not chunks:
            # Fallback: try any type
            cursor.execute(
                """
                SELECT id, content FROM document_tree
                WHERE document_id = ?
                ORDER BY id
                LIMIT 20
                """,
                (document_id,),
            )
            chunks = [(row[0], row[1]) for row in cursor.fetchall()]

        # Step 1: Extract concept names first (lightweight)
        concept_names = self._extract_concept_names(chunks, max_concepts * 2)

        # Step 2: Extract detailed information for each concept
        concepts = []
        for name in concept_names[:max_concepts]:
            try:
                # Find source chunks for this concept
                cursor.execute(
                    """
                    SELECT d.id, d.content FROM document_tree d
                    WHERE d.document_id = ? AND d.content LIKE ?
                    ORDER BY d.id
                    LIMIT 2
                    """,
                    (document_id, f"%{name}%"),
                )
                chunk_rows = cursor.fetchall()

                if not chunk_rows:
                    continue

                chunk_ids = [row[0] for row in chunk_rows]
                context = "\n\n".join(
                    [f"[Chunk {row[0]}]: {row[1][:600]}" for row in chunk_rows]
                )

                # Extract concept details with timeout handling
                concept_data = self._extract_single_concept(name, context)

                if concept_data:
                    embedding = self.client.embed(
                        f"{concept_data.name}: {concept_data.definition}"
                    )

                    concept = ConceptModel(
                        document_id=document_id,
                        theme_id=theme_ids[0] if theme_ids else None,
                        name=concept_data.name,
                        definition=concept_data.definition,
                        explanation=getattr(concept_data, "explanation", None),
                        examples=concept_data.examples,
                        importance_score=concept_data.importance_score,
                        category=getattr(concept_data, "category", "concept"),
                        source_chunk_ids=chunk_ids,
                        embedding=embedding,
                    )
                    concepts.append(concept)
            except Exception as e:
                print(f"Warning: Failed to process concept {name}: {e}")
                continue

        return concepts

    def _extract_concept_names(
        self,
        chunks: list[tuple[int, str]],
        max_names: int,
    ) -> list[str]:
        """Extract concept names from document chunks."""
        # Use first few chunks for concept identification - limit size to avoid timeout
        # Each chunk limited to 400 chars, max 3 chunks = 1200 chars total
        combined = "\n\n---\n\n".join(
            [f"[Chunk {ch[0]}]:\n{ch[1][:400]}" for ch in chunks[:3]]
        )

        prompt = f"""从以下学术文本中识别核心概念（关键术语/理论/方法）：

{combined}

请列出 {max_names} 个最重要的核心概念名称（名词术语），按重要性从高到低排序。
每行一个概念，不要编号，不要额外说明。"""

        try:
            response = self.client.generate(
                prompt,
                system="你是一个概念识别专家，擅长从学术文本中识别关键术语。",
                temperature=0.3,
            )
            concept_names = [
                line.strip().lstrip("0123456789.-* ")
                for line in response.strip().split("\n")
                if line.strip() and len(line.strip()) > 2
            ]
            return concept_names[:max_names]
        except Exception as e:
            print(f"Warning: Failed to extract concept names: {e}")
            return []

    def _extract_single_concept(
        self,
        name: str,
        context: str,
    ) -> Optional[EnhancedConcept]:
        """Extract detailed information for a single concept."""
        prompt = f"""从以下上下文中提取关于"{name}"的概念信息：

{context}

请提供：
1. 概念定义（1-2 句清晰定义）
2. 详细解释（扩展说明，可选）
3. 1-3 个具体例子
4. 重要性评分（0-1）
5. 类别（concept/principle/method/tool/person/event）

请严格按照 JSON 格式输出。"""

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=EnhancedConceptExtraction,
                system="你是一个知识提取专家，擅长提取概念的定义和例子。",
                temperature=0.4,
            )
            if result.concepts:
                return result.concepts[0]
        except Exception:
            # Fallback to simple extraction
            pass

        # Fallback: create minimal concept
        return EnhancedConcept(
            name=name,
            definition=f"{name} 是文本中的一个核心概念。",
            explanation=None,
            examples=[],
            importance_score=0.5,
            category="concept",
        )


class RelationExtractor:
    """Extract relationships between concepts."""

    def __init__(self, client: Optional[OllamaClient] = None):
        self.client = client or get_default_client()

    def extract(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        concepts: list[ConceptModel],
        max_relations: int = 50,
    ) -> list[RelationModel]:
        """
        Extract relationships between concepts.

        Relation types:
        - broader_than: A is a broader category/superconcept of B
        - narrower_than: A is a narrower category/subconcept of B
        - related_to: A and B are semantically related
        - similar_to: A and B are similar/analogous concepts
        - prerequisite_for: Understanding A is required for B
        - causes: A causes or leads to B
        - supports: A provides evidence/support for B
        - contradicts: A contradicts or opposes B
        """
        if len(concepts) < 2:
            return []

        # Build concept context
        concept_list = "\n".join(
            [f"- {c.name}: {c.definition[:100]}..." for c in concepts[:30]]
        )

        # Get context chunks for these concepts
        cursor = conn.cursor()
        all_chunk_ids = set()
        for c in concepts[:30]:
            all_chunk_ids.update(c.source_chunk_ids or [])

        if not all_chunk_ids:
            # If no chunk IDs, get general document content
            cursor.execute(
                """
                SELECT content FROM document_tree
                WHERE document_id = ?
                ORDER BY id
                LIMIT 20
                """,
                (document_id,),
            )
            context = "\n\n".join([row[0][:500] for row in cursor.fetchall()])
        else:
            placeholders = ",".join("?" * len(all_chunk_ids))
            cursor.execute(
                f"""
                SELECT content FROM document_tree
                WHERE id IN ({placeholders})
                """,
                list(all_chunk_ids),
            )
            context = "\n\n".join([row[0][:500] for row in cursor.fetchall()])

        # Extract relations with enhanced model
        prompt = f"""请分析以下概念列表，识别它们之间的语义关系：

概念列表：
{concept_list}

上下文参考：
{context[:4000]}

请识别概念之间的关系，关系类型包括：
- broader_than: A 是 B 的上级概念/更广泛的类别（A 包含 B）
- narrower_than: A 是 B 的下级概念/更具体的类别（A 被 B 包含）
- related_to: A 和 B 存在语义关联
- similar_to: A 和 B 是相似/类似的概念
- prerequisite_for: 理解 A 是学习 B 的前提/基础
- causes: A 导致/引起 B
- supports: A 支持/证明 B
- contradicts: A 与 B 矛盾/对立

对每个关系请提供：
1. 关系类型
2. 关系强度（0.3-1.0）
3. 文本证据（引用或改写）
4. 关系解释（为什么存在这个关系）

请输出最多{max_relations}个最重要的关系。"""

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=EnhancedRelationExtraction,
                system="你是一个关系分析专家，擅长识别概念之间的逻辑和语义关系。",
                temperature=0.5,
            )

            # Map concept names to IDs
            concept_map = {c.name: c.id for c in concepts}

            relations = []
            for rel in result.relations:
                source_id = concept_map.get(rel.source_concept)
                target_id = concept_map.get(rel.target_concept)

                if source_id and target_id and source_id != target_id:
                    relations.append(
                        RelationModel(
                            document_id=document_id,
                            source_concept_id=source_id,
                            target_concept_id=target_id,
                            relation_type=rel.relation_type,
                            strength=rel.strength,
                            evidence=rel.evidence,
                            explanation=rel.explanation,
                        )
                    )

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
        from ..database import (
            search_concepts_by_embedding,
            get_concepts,
            get_chunks_by_ids,
        )

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
        all_chunk_ids = []
        for c in combined:
            all_chunk_ids.extend(c.get("source_chunk_ids", []))

        if all_chunk_ids:
            chunks = get_chunks_by_ids(conn, list(set(all_chunk_ids))[:10])
            context = "\n\n".join([f"[来源]: {c['content'][:400]}" for c in chunks])
        else:
            context = "\n\n".join(
                [f"概念：{c['name']}\n定义：{c['definition']}" for c in combined[:5]]
            )

        # Generate answer
        prompt = f"""基于以下上下文信息，请回答用户的问题。

问题：{question}

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
