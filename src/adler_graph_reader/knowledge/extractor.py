"""
Knowledge extractors for themes, concepts, and relations.
"""

import sqlite3
from typing import Any, Optional

from ..config import get_config
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

        config = get_config()
        lang_suffix = config.get_prompt_suffix()

        if config.language == "zh":
            prompt = f"""从以下书籍内容中提取{max_themes}个主要主题：

{combined_content}

请为每个主题提供：
1. 主题名称（简洁的关键词）
2. 主题描述（一句话）
3. 重要性评分（0-1）

请严格按照格式输出。{lang_suffix}"""
            system_msg = "你是一个主题提取专家，擅长从文本中识别主要主题。"
        elif config.language == "en":
            prompt = f"""Extract {max_themes} major themes from the following book content:

{combined_content}

For each theme provide:
1. Theme name (concise keywords)
2. Theme description (one sentence)
3. Importance score (0-1)

Please output in the specified format. {lang_suffix}"""
            system_msg = "You are a theme extraction expert, skilled at identifying main themes from text."
        else:
            # Default to Chinese
            prompt = f"""从以下书籍内容中提取{max_themes}个主要主题：

{combined_content}

请为每个主题提供：
1. 主题名称（简洁的关键词）
2. 主题描述（一句话）
3. 重要性评分（0-1）

请严格按照格式输出。{lang_suffix}"""
            system_msg = "你是一个主题提取专家，擅长从文本中识别主要主题。"

        print(
            f"[ThemeExtractor] Calling LLM... (elapsed: {time.time() - start_time:.1f}s)"
        )

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=ThemeExtraction,
                system=system_msg,
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
        max_concepts: int = 100,
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
        # Increased from 20 to 50 chunks for better concept coverage
        cursor.execute(
            """
            SELECT id, content FROM document_tree
            WHERE document_id = ? AND type = 'chunk'
            ORDER BY RANDOM()
            LIMIT 200
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
                LIMIT 50
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
        config = get_config()
        lang_suffix = config.get_prompt_suffix()

        # Use more chunks for better concept coverage - increased from 3 to 10 chunks
        # Each chunk limited to 600 chars, max 10 chunks = 6000 chars total
        combined = "\n\n---\n\n".join(
            [f"[Chunk {ch[0]}]:\n{ch[1][:600]}" for ch in chunks[:10]]
        )

        if config.language == "zh":
            prompt = f"""从以下学术文本中识别核心概念（关键术语/理论/方法/技术/原则）：

{combined}

请列出 {max_names} 个最重要的核心概念名称（名词术语），按重要性从高到低排序。
每行一个概念，不要编号，不要额外说明。
确保提取的概念覆盖机器学习系统设计、模型训练、部署、监控等各个方面。{lang_suffix}"""
            system_msg = "你是一个概念识别专家，擅长从学术文本中识别关键术语。请尽可能多地提取重要概念。"
        else:  # English
            prompt = f"""Identify core concepts (key terms/theories/methods/technologies/principles) from the following academic text:

{combined}

List the {max_names} most important core concept names (noun terms), ranked by importance.
One concept per line, no numbering, no extra explanation.
Ensure the extracted concepts cover ML system design, model training, deployment, monitoring, etc. {lang_suffix}"""
            system_msg = "You are a concept recognition expert, skilled at identifying key terms from academic texts. Extract as many important concepts as possible."

        try:
            response = self.client.generate(
                prompt,
                system=system_msg,
                temperature=0.5,
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
        """Extract detailed information for a single concept with enhanced prompts."""
        config = get_config()
        lang_suffix = config.get_prompt_suffix()

        if config.language == "zh":
            prompt = f"""从以下上下文中提取关于"{name}"的概念信息：

{context}

请严格按照以下要求提取：

**1. 概念定义 (definition)**
- 必须基于文本中的明确定义或核心描述
- 使用"X是..."或"X指..."的句式
- 包含概念的核心特征和关键属性
- 避免循环定义（不要用概念本身来解释）
- 长度控制在50-150字

**2. 详细解释 (explanation)**
- 补充说明概念的背景、用途或意义
- 可以包含该概念在文本中的角色
- 如果文本中有相关讨论，简要概括

**3. 具体例子 (examples)**
- 必须从提供的上下文中提取真实例子
- 每个例子应该展示概念的具体应用或表现
- 如果没有具体例子，可以留空
- 最多3个例子，每个例子简洁明了

**4. 重要性评分 (importance_score)**
- 0.9-1.0: 核心概念，贯穿全文，是理解主题的关键
- 0.7-0.89: 重要概念，在多个章节出现
- 0.5-0.69: 一般概念，局部重要
- 0.3-0.49: 次要概念，提及较少
- 基于概念在文本中的出现频率和 centrality 判断

**5. 类别 (category)**
- concept: 抽象概念、理论、思想
- principle: 原则、法则、定理、规律
- method: 方法、技术、算法、流程
- tool: 工具、框架、平台、软件
- person: 人物、学者、专家
- event: 事件、里程碑、历史节点

请以 JSON 格式返回结果。{lang_suffix}"""
            system_msg = "你是学术知识提取专家，擅长从文本中精确提取概念的定义、例子和元数据。你的回答必须准确、专业、结构化。"
        else:
            prompt = f"""Extract concept information for "{name}" from the following context:

{context}

Please follow these requirements strictly:

**1. Definition**
- Must be based on explicit definition or core description in the text
- Use "X is..." or "X refers to..." format
- Include core characteristics and key attributes
- Avoid circular definitions
- Length: 50-150 characters

**2. Explanation**
- Supplementary background, usage, or significance
- Can include the concept's role in the text
- Summarize relevant discussions if present

**3. Examples**
- Must extract real examples from the provided context
- Each example should demonstrate concrete application
- Leave empty if no specific examples found
- Maximum 3 examples, concise and clear

**4. Importance Score (0-1)**
- 0.9-1.0: Core concept, essential for understanding the topic
- 0.7-0.89: Important concept, appears in multiple sections
- 0.5-0.69: General concept, locally important
- 0.3-0.49: Minor concept, rarely mentioned
- Based on frequency and centrality in text

**5. Category**
- concept: Abstract concepts, theories, ideas
- principle: Principles, laws, theorems, rules
- method: Methods, techniques, algorithms, processes
- tool: Tools, frameworks, platforms, software
- person: People, scholars, experts
- event: Events, milestones, historical moments

Return result in JSON format. {lang_suffix}"""
            system_msg = "You are an academic knowledge extraction expert, skilled at precisely extracting concept definitions, examples, and metadata from texts. Your answers must be accurate, professional, and well-structured."

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=EnhancedConceptExtraction,
                system=system_msg,
                temperature=0.3,  # Lower temperature for more consistent output
            )
            if result.concepts:
                concept = result.concepts[0]
                # Post-process to ensure quality
                concept.name = name  # Ensure name consistency
                # Validate and normalize importance score
                concept.importance_score = max(0.0, min(1.0, concept.importance_score))
                return concept
        except Exception as e:
            print(f"Warning: Structured extraction failed for '{name}': {e}")
            # Fallback to simple extraction

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

        config = get_config()
        lang_suffix = config.get_prompt_suffix()

        if config.language == "zh":
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

请输出最多{max_relations}个最重要的关系。{lang_suffix}"""
            system_msg = "你是一个关系分析专家，擅长识别概念之间的逻辑和语义关系。"
        else:  # English
            prompt = f"""Please analyze the following concept list and identify semantic relationships between them:

Concept List:
{concept_list}

Context Reference:
{context[:4000]}

Please identify relationships between concepts, including these types:
- broader_than: A is a broader category/superconcept of B (A contains B)
- narrower_than: A is a narrower category/subconcept of B (A is contained by B)
- related_to: A and B are semantically related
- similar_to: A and B are similar/analogous concepts
- prerequisite_for: Understanding A is required for learning B
- causes: A causes or leads to B
- supports: A provides evidence/support for B
- contradicts: A contradicts or opposes B

For each relationship provide:
1. Relationship type
2. Strength (0.3-1.0)
3. Text evidence (quote or paraphrase)
4. Explanation (why this relationship exists)

Please output up to {max_relations} most important relationships. {lang_suffix}"""
            system_msg = "You are a relationship analysis expert, skilled at identifying logical and semantic relationships between concepts."

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=EnhancedRelationExtraction,
                system=system_msg,
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

        config = get_config()
        lang_suffix = config.get_prompt_suffix()

        if config.language == "zh":
            prompt = f"""基于以下上下文信息，请回答用户的问题。

问题：{question}

相关概念和上下文:
{context}

请提供：
1. 答案
2. 引用的概念名称列表
3. 置信度评分（0-1）

如果无法从上下文中找到答案，请明确说明。{lang_suffix}"""
            system_msg = "你是一个问答专家，擅长基于给定的上下文回答问题。请只使用提供的上下文信息，不要编造。"
        else:  # English
            prompt = f"""Based on the following context information, please answer the user's question.

Question: {question}

Relevant concepts and context:
{context}

Please provide:
1. Answer
2. List of cited concept names
3. Confidence score (0-1)

If you cannot find the answer from the context, please state clearly. {lang_suffix}"""
            system_msg = "You are a Q&A expert, skilled at answering questions based on given context. Please only use the provided context information, do not make up answers."

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=QAResponse,
                system=system_msg,
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
