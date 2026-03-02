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
            prompt = f"""从以下学术文献上下文中提取关于"【{name}】"的精确概念信息。

## 上下文内容
{context}

## 提取要求（必须严格遵循）

### 1. 概念定义 (definition) - 最关键字段
- 来源：必须基于文本中的**明确定义句**或**核心描述**
- 句式：使用"【{name}】是..."或"【{name}】指..."的精准定义句式
- 内容：必须包含概念的本质特征、关键属性和适用范围
- 禁止：避免循环定义（同义词重复）、避免空洞描述
- 长度：80-200字，要完整但不要冗余

### 2. 详细解释 (explanation) - 补充说明
- 背景：概念产生的背景或解决什么问题
- 用途：在机器学习系统中的实际应用场景
- 重要性：为什么这个概念值得学习
- 如果上下文没有足够信息，用"根据上下文无法确定详细解释"代替

### 3. 具体例子 (examples) - 必须来自上下文
- 筛选：选择最能体现概念本质的2-3个例子
- 要求：每个例子必须可追溯到上下文中的具体描述
- 格式：简洁的一句话例子，不要解释
- 如无真实例子，设为空数组[]

### 4. 重要性评分 (importance_score) - 0.0-1.0
评分标准：
- 0.85-1.0: 核心概念，书中反复出现，是理解全书的关键
- 0.70-0.84: 重要概念，在多个章节中被详细讨论
- 0.50-0.69: 常用概念，在部分章节出现
- 0.30-0.49: 辅助概念，偶尔提及
- 0.10-0.29: 边缘概念，仅提及一次

### 5. 类别 (category)
从以下选项中选择最合适的一个：
- method: 方法、技术、算法、流程（最常用）
- concept: 抽象概念、理论、模型
- principle: 原则、法则、定理、规律
- tool: 工具、框架、平台、软件
- person: 人物、学者、专家
- event: 事件、里程碑、历史节点

## 输出格式要求
- 必须返回有效的JSON对象
- 所有字段都必须在输出中包含
- examples字段必须是数组，优先使用中文标点符号

## 思考步骤（供你参考，但不要输出）
1. 首先在上下文中找到【{name}】的定义句
2. 判断这个概念属于哪个类别
3. 找出2-3个具体的例子
4. 根据出现频率和重要性给出评分

请开始提取：{lang_suffix}"""
            system_msg = """你是一个专业的学术知识提取专家。你的任务是：
1. 严格基于给定上下文提取信息，不编造
2. 定义必须精确、可操作
3. 例子必须真实可查
4. 评分必须客观公正
5. 始终保持JSON输出格式正确"""
        else:
            prompt = f"""Extract precise concept information for "【{name}]" from the following academic context.

## Context Content
{context}

## Extraction Requirements (Must Follow Strictly)

### 1. Definition (definition) - Most Critical Field
- Source: Must be based on explicit definition sentences or core descriptions in the text
- Format: Use precise definition like "【{name}] is..." or "【{name}] refers to..."
- Content: Must include essential features, key attributes, and applicable scope
- Forbidden: Avoid circular definitions, avoid vague descriptions
- Length: 80-200 characters, complete but not redundant

### 2. Explanation (explanation) - Supplementary
- Background: Context where the concept emerges or problem it solves
- Usage: Practical application scenarios in ML systems
- Importance: Why this concept is worth learning
- If insufficient info: State "Cannot determine from context"

### 3. Examples (examples) - Must Be From Context
- Selection: Choose 2-3 examples that best represent the concept's essence
- Requirement: Each example must be traceable to specific descriptions in context
- Format: Concise one-sentence examples without explanation
- If no real examples: set to empty array []

### 4. Importance Score (importance_score) - 0.0-1.0
Scoring criteria:
- 0.85-1.0: Core concept, appears repeatedly, key to understanding the book
- 0.70-0.84: Important concept, discussed in multiple chapters
- 0.50-0.69: Common concept, appears in some chapters
- 0.30-0.49: Supporting concept, mentioned occasionally
- 0.10-0.29: Marginal concept, mentioned once

### 5. Category (category)
Choose the most appropriate:
- method: Methods, techniques, algorithms, processes (most common)
- concept: Abstract concepts, theories, models
- principle: Principles, laws, theorems, rules
- tool: Tools, frameworks, platforms, software
- person: People, scholars, experts
- events: Events, milestones, historical moments

## Output Format Requirements
- Must return valid JSON object
- All fields must be included in output
- examples field must be an array

## Thinking Steps (For your reference, do not output)
1. First find definition sentences for 【{name}] in context
2. Determine which category this concept belongs to
3. Find 2-3 specific examples
4. Give score based on frequency and importance

Please start extraction: {lang_suffix}"""
            system_msg = """You are a professional academic knowledge extraction expert. Your tasks are:
1. Strictly extract information from given context, do not fabricate
2. Definitions must be precise and actionable
3. Examples must be verifiable
4. Scores must be objective and fair
5. Always maintain correct JSON output format"""

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=EnhancedConceptExtraction,
                system=system_msg,
                temperature=0.2,  # Even lower temperature for more consistent quality
            )
            if result.concepts:
                concept = result.concepts[0]
                # Post-process to ensure quality
                concept.name = name  # Ensure name consistency
                
                # Validate and normalize importance score
                concept.importance_score = max(0.1, min(1.0, concept.importance_score))
                
                # Ensure examples is a list
                if concept.examples is None:
                    concept.examples = []
                
                # Clean up examples - remove empty strings
                concept.examples = [ex.strip() for ex in concept.examples if ex and ex.strip()]
                
                return concept
        except Exception as e:
            print(f"Warning: Structured extraction failed for '{name}': {e}")
            import traceback
            traceback.print_exc()

        # Fallback: create minimal concept
        return EnhancedConcept(
            name=name,
            definition=f"{name} 是文本中的一个核心概念，与机器学习系统设计相关。",
            explanation="该概念在机器学习系统设计中具有重要作用。",
            examples=[],
            importance_score=0.5,
            category="method",
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
