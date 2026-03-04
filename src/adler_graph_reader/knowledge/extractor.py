"""
Knowledge extractors for themes, concepts, and relations.
"""

import sqlite3
from typing import Any, Optional

from ..config import get_config
from ..llm import OllamaClient, get_default_client
from ..llm.models import (
    EnhancedConcept,
    EnhancedConceptExtraction,
    EnhancedRelationExtraction,
    ThemeExtraction,
)
from .graph_models import ConceptModel, RelationModel, ThemeModel
from .progress import ExtractionProgress, ExtractionStage, ProgressManager


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

        # Get actual content from chunks, not just chapter titles
        cursor.execute(
            """
            SELECT content FROM document_tree
            WHERE document_id = ? AND type = 'chunk'
            AND length(content) > 100
            ORDER BY id
            LIMIT 10
            """,
            (document_id,),
        )
        contents = [row[0] for row in cursor.fetchall()]
        print(f"[ThemeExtractor] Found {len(contents)} chunks with content")

        if not contents:
            cursor.execute(
                """
                SELECT content FROM document_tree
                WHERE document_id = ? AND type = 'chunk'
                ORDER BY id
                LIMIT 10
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

    # Configuration for full extraction (方案B: 全量抽取)
    CHUNKS_PER_BATCH = 50  # Increased for better throughput
    MAX_CHUNKS_TO_PROCESS = 10000  # Process all chunks in large documents
    CONCEPTS_PER_CHUNK_RATIO = 0.055  # ~292 concepts for 5311 chunks
    MIN_CONCEPTS = 250  # Ensure minimum concept count
    MAX_CONCEPTS_HARD_LIMIT = 500  # Allow more concepts

    def __init__(self, client: Optional[OllamaClient] = None):
        self.client = client or get_default_client()

    def _get_total_chunks(self, conn: sqlite3.Connection, document_id: str) -> int:
        """Get total number of chunks for a document."""
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COUNT(*) FROM document_tree
            WHERE document_id = ? AND type = 'chunk'
            """,
            (document_id,),
        )
        return cursor.fetchone()[0]

    def _calculate_target_concepts(self, total_chunks: int) -> int:
        """Calculate target number of concepts based on document size."""
        target = int(total_chunks * self.CONCEPTS_PER_CHUNK_RATIO)
        # Clamp between min and max
        return max(self.MIN_CONCEPTS, min(target, self.MAX_CONCEPTS_HARD_LIMIT))

    def _get_chunk_batch(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        offset: int,
        limit: int,
    ) -> list[tuple[int, str]]:
        """Get a batch of chunks for processing."""
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, content FROM document_tree
            WHERE document_id = ? AND type = 'chunk'
            ORDER BY id
            LIMIT ? OFFSET ?
            """,
            (document_id, limit, offset),
        )
        return [(row[0], row[1]) for row in cursor.fetchall()]

    def _extract_concept_names_from_batch(
        self,
        chunks: list[tuple[int, str]],
        max_names: int,
        existing_names: set[str],
    ) -> list[str]:
        """Extract concept names from a batch of chunks using recursive splitting."""
        config = get_config()
        lang_suffix = config.get_prompt_suffix()

        # 方案B: 使用递归切分处理所有chunks
        all_new_names: list[str] = []

        # 递归处理函数
        def process_chunk_group(
            chunk_group: list[tuple[int, str]], level: int = 0
        ) -> list[str]:
            if not chunk_group:
                return []

            # 估算token数 (粗略: 1 token ≈ 4 chars for Chinese, 4 chars for English)
            total_chars = sum(len(ch[1]) for ch in chunk_group)
            estimated_tokens = total_chars // 4

            # 如果内容太多，递归切分
            # LLM 上下文通常 8k-32k，但我们需要留出生成空间
            max_llm_tokens = 4000  # 保守估计，给生成留空间
            if estimated_tokens > max_llm_tokens and len(chunk_group) > 1 and level < 5:
                # 切分成两半递归处理
                mid = len(chunk_group) // 2
                left_names = process_chunk_group(chunk_group[:mid], level + 1)
                right_names = process_chunk_group(chunk_group[mid:], level + 1)
                return left_names + right_names

            # 构建prompt - 使用完整内容，不截断
            combined = "\n\n---\n\n".join(
                [f"[Chunk {ch[0]}]:\n{ch[1]}" for ch in chunk_group]
            )

            if config.language == "zh":
                prompt = f"""从以下学术文本中识别核心概念（关键术语/理论/方法/技术/原则）：

{combined}

请列出最多 {max_names} 个最重要的核心概念名称（名词术语），按重要性从高到低排序。
每行一个概念，不要编号，不要额外说明。
确保提取的概念覆盖机器学习系统设计、模型训练、部署、监控等各个方面。{lang_suffix}"""
                system_msg = "你是一个概念识别专家，擅长从学术文本中识别关键术语。请尽可能多地提取重要概念，但只返回真实存在的概念名称。"
            else:  # English
                prompt = f"""Identify core concepts (key terms/theories/methods/technologies/principles) from the following academic text:

{combined}

List up to {max_names} most important core concept names (noun terms), ranked by importance.
One concept per line, no numbering, no extra explanation.
Ensure the extracted concepts cover ML system design, model training, deployment, monitoring, etc. {lang_suffix}"""
                system_msg = "You are a concept recognition expert, skilled at identifying key terms from academic texts. Extract as many important concepts as possible, but only return real concept names."

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
                return concept_names
            except Exception as e:
                print(f"Warning: Failed to extract concept names from batch: {e}")
                return []

        # 处理所有chunks
        names = process_chunk_group(chunks)

        # 去重并限制数量
        for name in names:
            name_lower = name.lower()
            if name_lower not in existing_names:
                all_new_names.append(name)
                existing_names.add(name_lower)
                if len(all_new_names) >= max_names:
                    break

        return all_new_names

    def extract(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        theme_ids: Optional[list[int]] = None,
        max_concepts: Optional[int] = None,
        progress: Optional[ExtractionProgress] = None,
        progress_manager: Optional[ProgressManager] = None,
    ) -> list[ConceptModel]:
        """
        Extract concepts from document using batch processing with progress tracking.

        Pipeline:
        1. Calculate target concept count based on document size
        2. Process chunks in batches to collect concept candidates
        3. Extract detailed information for each unique concept
        4. Support resumable extraction via progress tracking
        """
        cursor = conn.cursor()

        # Get total chunks and calculate target
        total_chunks = self._get_total_chunks(conn, document_id)
        target_concepts = max_concepts or self._calculate_target_concepts(total_chunks)
        target_concepts = min(target_concepts, self.MAX_CONCEPTS_HARD_LIMIT)

        print(f"[ConceptExtractor] Document has {total_chunks} chunks")
        print(f"[ConceptExtractor] Target concepts: {target_concepts}")

        # Update progress
        if progress and progress_manager:
            progress.stage = ExtractionStage.CONCEPTS_EXTRACTING
            progress.total_concepts = target_concepts
            progress_manager.save_progress(progress)

        # Step 1: Collect concept candidates from batches
        all_concept_names: list[str] = []
        existing_names: set[str] = set()

        # Check if we have a partially processed queue
        if progress and progress.concept_queue:
            print(
                f"[ConceptExtractor] Resuming with {len(progress.concept_queue)} concepts in queue"
            )
            all_concept_names = progress.concept_queue.copy()
            existing_names = {name.lower() for name in progress.processed_concepts}
            existing_names.update({name.lower() for name in all_concept_names})
        else:
            # Determine how many chunks to process
            chunks_to_process = min(total_chunks, self.MAX_CHUNKS_TO_PROCESS)
            num_batches = (
                chunks_to_process + self.CHUNKS_PER_BATCH - 1
            ) // self.CHUNKS_PER_BATCH

            print(
                f"[ConceptExtractor] Processing {chunks_to_process} chunks in {num_batches} batches"
            )

            for batch_idx in range(num_batches):
                offset = batch_idx * self.CHUNKS_PER_BATCH
                chunks = self._get_chunk_batch(
                    conn, document_id, offset, self.CHUNKS_PER_BATCH
                )

                if not chunks:
                    break

                # Calculate how many new concepts to extract from this batch
                remaining_slots = target_concepts * 2 - len(all_concept_names)
                if remaining_slots <= 0:
                    break

                batch_max = min(
                    50, remaining_slots // (num_batches - batch_idx + 1) + 10
                )

                print(
                    f"[ConceptExtractor] Batch {batch_idx + 1}/{num_batches}: extracting up to {batch_max} concepts"
                )

                batch_names = self._extract_concept_names_from_batch(
                    chunks, batch_max, existing_names
                )
                all_concept_names.extend(batch_names)

                print(
                    f"[ConceptExtractor] Batch {batch_idx + 1}: found {len(batch_names)} new concepts (total: {len(all_concept_names)})"
                )

                # Early termination if we have enough candidates
                if len(all_concept_names) >= target_concepts * 1.5:
                    print(
                        f"[ConceptExtractor] Collected enough concept candidates ({len(all_concept_names)})"
                    )
                    break

        # Step 2: Extract detailed information for each concept
        concepts: list[ConceptModel] = []

        # Initialize progress queue if needed
        if progress:
            if not progress.concept_queue:
                progress.concept_queue = all_concept_names.copy()
            progress.total_concepts = min(len(all_concept_names), target_concepts)
            if progress_manager:
                progress_manager.save_progress(progress)

        # Process concepts in batches
        names_to_process = all_concept_names[:target_concepts]
        processed_count = 0
        BATCH_SIZE = 8  # Process 8 concepts per LLM call

        # Pre-fetch contexts for all concepts to process
        print(f"[ConceptExtractor] Preparing contexts for {len(names_to_process)} concepts...")
        concept_contexts: dict[str, tuple[list[int], str]] = {}
        for name in names_to_process:
            # Skip already processed concepts when resuming
            if progress and name in progress.processed_concepts:
                continue

            cursor.execute(
                """
                SELECT d.id, d.content FROM document_tree d
                WHERE d.document_id = ? AND d.content LIKE ?
                ORDER BY d.id
                LIMIT 3
                """,
                (document_id, f"%{name}%"),
            )
            chunk_rows = cursor.fetchall()

            if chunk_rows:
                chunk_ids = [row[0] for row in chunk_rows]
                context = "\n\n".join(
                    [f"[Chunk {row[0]}]: {row[1][:600]}" for row in chunk_rows]
                )
                concept_contexts[name] = (chunk_ids, context)
            else:
                # Mark as processed if no chunks found
                if progress and progress_manager:
                    progress.mark_concept_processed(name)

        # Get names that need processing (have contexts)
        names_with_context = [name for name in names_to_process if name in concept_contexts]
        print(f"[ConceptExtractor] Processing {len(names_with_context)} concepts in batches of {BATCH_SIZE}")

        # Process in batches
        for batch_start in range(0, len(names_with_context), BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, len(names_with_context))
            batch_names = names_with_context[batch_start:batch_end]

            print(f"[ConceptExtractor] Batch {batch_start//BATCH_SIZE + 1}: processing {len(batch_names)} concepts")

            # Prepare contexts for this batch
            batch_contexts = {name: concept_contexts[name][1] for name in batch_names}

            try:
                # Extract batch
                batch_results = self._extract_concepts_batch(batch_names, batch_contexts)

                if batch_results:
                    print(f"[ConceptExtractor] Batch extracted {len(batch_results)} concepts")

                    for concept_data in batch_results:
                        # Find matching concept name (case-insensitive)
                        matching_name = None
                        for name in batch_names:
                            if name.lower() == concept_data.name.lower():
                                matching_name = name
                                break

                        if not matching_name:
                            # Try exact match
                            for name in batch_names:
                                if name in concept_data.name or concept_data.name in name:
                                    matching_name = name
                                    break

                        if matching_name:
                            chunk_ids, _ = concept_contexts[matching_name]

                            try:
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
                                processed_count += 1
                            except Exception as e:
                                print(f"Warning: Failed to create concept {concept_data.name}: {e}")

                        # Mark as processed
                        if progress and progress_manager:
                            progress.mark_concept_processed(matching_name or concept_data.name)

                else:
                    # Batch failed, fall back to individual extraction
                    print("[ConceptExtractor] Batch failed, falling back to individual extraction")
                    for name in batch_names:
                        chunk_ids, context = concept_contexts[name]
                        concept_data = self._extract_single_concept(name, context)

                        if concept_data:
                            try:
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
                                processed_count += 1
                            except Exception as e:
                                print(f"Warning: Failed to create concept {name}: {e}")

                        if progress and progress_manager:
                            progress.mark_concept_processed(name)

                # Update progress
                if progress and progress_manager:
                    progress.extracted_concepts = len(concepts)
                    progress_manager.save_progress(progress)
                    print(
                        f"[ConceptExtractor] Progress: {len(concepts)}/{target_concepts} concepts extracted"
                    )

            except Exception as e:
                print(f"Warning: Batch processing failed: {e}")
                # Continue to next batch
                for name in batch_names:
                    if progress and progress_manager:
                        progress.mark_concept_processed(name)

        # Final progress update
        if progress and progress_manager:
            progress.stage = ExtractionStage.CONCEPTS_COMPLETE
            progress.extracted_concepts = len(concepts)
            progress_manager.save_progress(progress)

        print(f"[ConceptExtractor] Completed: extracted {len(concepts)} concepts")
        return concepts

    def _extract_concepts_batch(
        self,
        concept_names: list[str],
        contexts: dict[str, str],
    ) -> list[EnhancedConcept]:
        """
        Extract detailed information for multiple concepts in a single LLM call.

        Args:
            concept_names: List of concept names to extract
            contexts: Dict mapping concept name to context text

        Returns:
            List of EnhancedConcept objects
        """
        config = get_config()
        lang_suffix = config.get_prompt_suffix()

        # Build concept list for prompt
        concept_list = "\n".join([f"- {name}" for name in concept_names])

        # Combine contexts with separators
        context_parts = []
        for name in concept_names:
            ctx = contexts.get(name, "")
            if ctx:
                context_parts.append(f"## Context for '{name}':\n{ctx[:800]}")
        combined_context = "\n\n---\n\n".join(context_parts)

        if config.language == "zh":
            prompt = f"""从以下上下文中提取这些概念的详细信息：

## 概念列表
{concept_list}

## 上下文内容
{combined_context}

## 提取要求

对于每个概念，请提取以下信息：
1. **name**: 概念名称（从列表中选择）
2. **definition**: 精确定义（80-200字，基于上下文中的定义句）
3. **explanation**: 详细解释（背景、用途、重要性）
4. **examples**: 具体例子列表（2-3个，必须来自上下文）
5. **importance_score**: 重要性评分（0.0-1.0）
   - 0.85-1.0: 核心概念，书中反复出现
   - 0.70-0.84: 重要概念，多个章节讨论
   - 0.50-0.69: 常用概念，部分章节出现
   - 0.30-0.49: 辅助概念，偶尔提及
6. **category**: 类别（method/concept/principle/tool/person/event）

## 输出格式
返回JSON对象，包含一个concepts数组，每个元素包含上述字段。
确保所有{len(concept_names)}个概念都在输出中。{lang_suffix}"""
            system_msg = """你是一个专业的学术知识提取专家。请严格遵循以下规则：
1. 基于给定上下文提取信息，不编造
2. 定义必须精确、可操作
3. 例子必须真实可查
4. 评分必须客观公正
5. 返回有效的JSON格式"""
        else:
            prompt = f"""Extract detailed information for these concepts from the context:

## Concept List
{concept_list}

## Context Content
{combined_context}

## Extraction Requirements

For each concept, extract:
1. **name**: Concept name (from the list)
2. **definition**: Precise definition (80-200 chars, based on context)
3. **explanation**: Detailed explanation (background, usage, importance)
4. **examples**: List of concrete examples (2-3 items, must be from context)
5. **importance_score**: Importance score (0.0-1.0)
   - 0.85-1.0: Core concept, appears repeatedly
   - 0.70-0.84: Important concept, discussed in multiple chapters
   - 0.50-0.69: Common concept, appears in some chapters
   - 0.30-0.49: Supporting concept, mentioned occasionally
6. **category**: Category (method/concept/principle/tool/person/event)

## Output Format
Return JSON object with a "concepts" array, each element containing the above fields.
Ensure all {len(concept_names)} concepts are included in the output. {lang_suffix}"""
            system_msg = """You are a professional academic knowledge extraction expert. Follow these rules:
1. Extract strictly from given context, do not fabricate
2. Definitions must be precise and actionable
3. Examples must be verifiable
4. Scores must be objective and fair
5. Return valid JSON format"""

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=EnhancedConceptExtraction,
                system=system_msg,
                temperature=0.2,
            )
            if result.concepts:
                # Validate and fix each concept
                for concept in result.concepts:
                    concept.importance_score = max(0.1, min(1.0, concept.importance_score))
                    if concept.examples is None:
                        concept.examples = []
                    concept.examples = [
                        ex.strip() for ex in concept.examples if ex and ex.strip()
                    ]
                return result.concepts
        except Exception as e:
            print(f"Warning: Batch extraction failed: {e}")

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
                concept.examples = [
                    ex.strip() for ex in concept.examples if ex and ex.strip()
                ]

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
    """Extract relationships between concepts with enhanced strategies."""

    def __init__(self, client: Optional[OllamaClient] = None):
        self.client = client or get_default_client()

    def extract(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        concepts: list[ConceptModel],
        max_relations: int = 400,
    ) -> list[RelationModel]:
        """
        Extract relationships between concepts using multi-strategy approach.

        Processes all concepts in batches of 60, sorted by importance.
        Enhanced relation types:
        - broader_than: A is a broader category/superconcept of B
        - narrower_than: A is a narrower category/subconcept of B
        - related_to: A and B are semantically related
        """
        if len(concepts) < 2:
            print("[RelationExtractor] Not enough concepts to extract relations")
            return []

        # Sort concepts by importance score (descending) to prioritize important concepts
        sorted_concepts = sorted(
            concepts,
            key=lambda c: c.importance_score or 0.5,
            reverse=True
        )

        BATCH_SIZE = 60
        all_relations: list[RelationModel] = []
        seen_pairs: set = set()

        # Map concept names to IDs for all concepts
        concept_map = {c.name: c.id for c in concepts}

        print(
            f"[RelationExtractor] Processing {len(sorted_concepts)} concepts in batches of {BATCH_SIZE}"
        )

        # Process concepts in batches
        for batch_start in range(0, len(sorted_concepts), BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, len(sorted_concepts))
            batch_concepts = sorted_concepts[batch_start:batch_end]

            print(
                f"[RelationExtractor] Batch {batch_start//BATCH_SIZE + 1}: "
                f"processing concepts {batch_start+1}-{batch_end}"
            )

            batch_relations = self._extract_relations_for_batch(
                conn=conn,
                document_id=document_id,
                concepts=batch_concepts,
                concept_map=concept_map,
                seen_pairs=seen_pairs,
                max_relations=min(max_relations, len(batch_concepts) * 3),
            )

            all_relations.extend(batch_relations)
            print(
                f"[RelationExtractor] Batch extracted {len(batch_relations)} relations "
                f"(total: {len(all_relations)})"
            )

            # Early stop if we have enough relations
            if len(all_relations) >= max_relations:
                print(f"[RelationExtractor] Reached max_relations limit ({max_relations})")
                break

        print(f"[RelationExtractor] Total unique relations: {len(all_relations[:max_relations])}")
        return all_relations[:max_relations]

    def _extract_relations_for_batch(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        concepts: list[ConceptModel],
        concept_map: dict[str, int],
        seen_pairs: set,
        max_relations: int,
    ) -> list[RelationModel]:
        """
        Extract relations for a single batch of concepts.

        Args:
            conn: Database connection
            document_id: Document ID
            concepts: Batch of concepts to process
            concept_map: Mapping from concept name to ID
            seen_pairs: Set of already seen (source, target, type) tuples
            max_relations: Maximum relations to extract for this batch

        Returns:
            List of RelationModel objects
        """
        # Build concept list for prompt
        concept_list = "\n".join(
            [f"- {c.name} ({c.category or 'concept'}, importance: {c.importance_score or 0.5:.2f})"
             for c in concepts]
        )

        # Get chunk IDs from all concepts in this batch
        all_chunk_ids = set()
        for c in concepts:
            all_chunk_ids.update(c.source_chunk_ids or [])

        # Get context from chunks
        cursor = conn.cursor()
        context = ""
        if all_chunk_ids:
            placeholders = ",".join(["?"] * len(all_chunk_ids))
            cursor.execute(
                f"""
                SELECT content FROM document_tree
                WHERE id IN ({placeholders})
                ORDER BY RANDOM()
                LIMIT 30
                """,
                list(all_chunk_ids),
            )
            context = "\n\n".join([row[0][:600] for row in cursor.fetchall()])

        config = get_config()
        lang_suffix = config.get_prompt_suffix()

        if config.language == "zh":
            prompt = f"""作为知识图谱构建专家，请深入分析以下概念列表，识别它们之间所有可能的语义关系。

## 概念列表（共{len(concepts)}个）：
{concept_list}

## 上下文参考：
{context[:5000]}

## 任务要求

### 关系类型定义（必须优先使用具体类型，少用related_to）：
**层级关系：**
- broader_than: A 是 B 的上级概念/更广泛的类别（A 包含 B，如：机器学习 > 监督学习）
- narrower_than: A 是 B 的下级概念/更具体的类别（A 被 B 包含）
- part_of: A 是 B 的组成部分/子模块（如：特征工程 是 机器学习系统 的一部分）

**逻辑关系：**
- prerequisite_for: 理解/掌握 A 是学习 B 的前提条件（如：线性代数 是 神经网络 的基础）
- causes: A 导致/引起 B 的发生（因果关系）
- produces: A 产生/生成 B（如：训练过程 产生 模型）

**功能关系：**
- implements: A 实现了 B（如：随机森林算法 实现了 集成学习）
- uses: A 使用/应用了 B（如：深度学习 使用 GPU）
- evaluates: A 用于评估/测量 B（如：准确率 评估 模型性能）
- improves: A 改进/提升了 B（如：数据增强 改进 模型泛化能力）

**语义关系：**
- similar_to: A 和 B 是相似/可类比的概念（如：精确率 ~ 召回率）
- supports: A 支持/证明 B（如：实验结果 支持 理论假设）
- contradicts: A 与 B 矛盾/对立（如：过拟合 与 欠拟合）
- related_to: 仅当以上类型都不适用时使用（通用关联）

### 提取策略：
1. **全面性**：每个概念至少应该有2-3个出边关系
2. **多样性**：尽量使用不同类型的关系，不要只使用related_to
3. **方向性**：注意关系的方向，A→B 和 B→A 是不同的关系
4. **层次结构**：识别概念之间的层级结构（上下位关系）
5. **流程关系**：识别ML系统中的工作流程（数据→特征→模型→评估→部署）
6. **依赖关系**：识别概念之间的依赖和使用关系

### 输出要求：
- 最少提取 {min(max_relations, len(concepts) * 2)} 个关系
- 最多提取 {max_relations} 个关系
- 每个关系必须包含：源概念、目标概念、关系类型、强度(0.3-1.0)、文本证据、解释
- 优先选择有明确文本证据支持的关系

请尽可能多地识别有意义的关系，构建丰富的知识图谱。{lang_suffix}"""
            system_msg = """你是知识图谱构建专家，擅长从学术文献中识别概念间的复杂关系。
你的任务是：
1. 深入理解每个概念的含义和作用
2. 识别概念间的多种关系类型（层级、因果、功能、语义）
3. 构建完整的概念网络，确保每个概念都有多个连接
4. 优先使用具体的关系类型，避免过度使用related_to
5. 确保关系有文本证据支持，不编造不存在的关系"""
        else:  # English
            prompt = f"""As a knowledge graph construction expert, please deeply analyze the following concept list and identify all possible semantic relationships between them.

## Concept List ({len(concepts)} concepts):
{concept_list}

## Context Reference:
{context[:5000]}

## Task Requirements

### Relation Type Definitions (use specific types, avoid overusing related_to):
**Hierarchical Relations:**
- broader_than: A is a broader category of B (A contains B, e.g., ML > Supervised Learning)
- narrower_than: A is a narrower category of B (A is contained by B)
- part_of: A is a component/part of B (e.g., Feature Engineering is part of ML System)

**Logical Relations:**
- prerequisite_for: Understanding A is required for B (e.g., Linear Algebra for Neural Networks)
- causes: A causes/leads to B (causal relationship)
- produces: A produces/generates B (e.g., Training produces Model)

**Functional Relations:**
- implements: A implements/realizes B (e.g., Random Forest implements Ensemble Learning)
- uses: A uses/applies B (e.g., Deep Learning uses GPUs)
- evaluates: A evaluates/measures B (e.g., Accuracy evaluates Model Performance)
- improves: A improves/enhances B (e.g., Data Augmentation improves Generalization)

**Semantic Relations:**
- similar_to: A and B are similar/analogous (e.g., Precision ~ Recall)
- supports: A provides evidence for B (e.g., Results support Hypothesis)
- contradicts: A contradicts/opposes B (e.g., Overfitting vs Underfitting)
- related_to: Only use when none of above apply (generic association)

### Extraction Strategy:
1. **Comprehensiveness**: Each concept should have at least 2-3 outgoing relations
2. **Diversity**: Use various relation types, not just related_to
3. **Directionality**: Note that A→B and B→A are different relations
4. **Hierarchy**: Identify hierarchical structures (super/sub-concepts)
5. **Workflow**: Identify ML system workflows (Data → Features → Model → Eval → Deploy)
6. **Dependencies**: Identify dependencies and usage relationships

### Output Requirements:
- Minimum {min(max_relations, len(concepts) * 2)} relations
- Maximum {max_relations} relations
- Each relation must include: source, target, type, strength(0.3-1.0), evidence, explanation
- Prioritize relations with clear text evidence

Please identify as many meaningful relationships as possible to build a rich knowledge graph. {lang_suffix}"""
            system_msg = """You are a knowledge graph construction expert skilled at identifying complex relationships in academic literature.
Your tasks:
1. Deeply understand each concept's meaning and role
2. Identify multiple relation types (hierarchical, causal, functional, semantic)
3. Build a complete concept network with multiple connections per concept
4. Prefer specific relation types over generic related_to
5. Ensure relations have text evidence, don't fabricate relationships"""

        try:
            result = self.client.generate_structured(
                prompt,
                response_model=EnhancedRelationExtraction,
                system=system_msg,
                temperature=0.3,
            )

            relations = []

            for rel in result.relations:
                source_id = concept_map.get(rel.source_concept)
                target_id = concept_map.get(rel.target_concept)

                # Skip invalid relations
                if not source_id or not target_id or source_id == target_id:
                    continue

                # Create unique pair identifier (sorted to handle bidirectional)
                pair_key = (
                    min(source_id, target_id),
                    max(source_id, target_id),
                    rel.relation_type,
                )
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                relations.append(
                    RelationModel(
                        document_id=document_id,
                        source_concept_id=source_id,
                        target_concept_id=target_id,
                        relation_type=rel.relation_type,
                        strength=max(0.3, min(1.0, rel.strength)),
                        evidence=rel.evidence,
                        explanation=rel.explanation,
                    )
                )

            return relations
        except Exception as e:
            print(f"Warning: LLM failed to extract relations: {e}")
            print("[RelationExtractor] Falling back to rule-based relation extraction...")
            # Fallback to rule-based extraction
            return self._extract_relations_rule_based(
                conn=conn,
                document_id=document_id,
                concepts=concepts,
                concept_map=concept_map,
                seen_pairs=seen_pairs,
                max_relations=max_relations,
            )

    def _extract_relations_rule_based(
        self,
        conn: sqlite3.Connection,
        document_id: str,
        concepts: list[ConceptModel],
        concept_map: dict[str, int],
        seen_pairs: set,
        max_relations: int,
    ) -> list[RelationModel]:
        """
        Extract relations using rule-based approach as fallback when LLM fails.
        
        Uses concept names and categories to infer relationships:
        - Same category → related_to
        - Keywords in names → specific relation types
        - Importance score differences → broader/narrower
        """
        import re
        
        # Keywords that indicate specific relation types
        KEYWORD_PATTERNS = {
            "prerequisite_for": ["basis", "foundation", "prerequisite", "requirement", "基础", "前提", "要求"],
            "causes": ["cause", "lead to", "result in", "导致", "引起", "结果"],
            "produces": ["produce", "generate", "create", "create", "产生", "生成", "创建"],
            "uses": ["use", "apply", "employ", "utilize", "使用", "应用", "利用"],
            "part_of": ["part of", "component", "module", "part of", "的一部分"],
            "evaluates": ["evaluate", "measure", "assess", "metric", "评估", "测量"],
            "improves": ["improve", "enhance", "optimize", "better", "改进", "优化", "提升"],
            "similar_to": ["similar", "analogous", "like", "similar to", "类似"],
        }
        
        relations = []
        
        # Get all concept names and categories
        concept_names = [c.name.lower() for c in concepts]
        
        for i, c1 in enumerate(concepts):
            for j, c2 in enumerate(concepts):
                if i >= j:
                    continue
                
                # Check if we've already seen this pair
                pair_key = (min(c1.id, c2.id), max(c1.id, c2.id), "temp")
                if pair_key[:2] in [(min(s[0], s[1]), max(s[0], s[1])) for s in seen_pairs]:
                    continue
                
                relation_type = "related_to"
                strength = 0.5
                evidence = "Rule-based: inferred from concept names and categories"
                explanation = ""
                
                # Check keyword patterns
                name1_lower = c1.name.lower()
                name2_lower = c2.name.lower()
                
                for rel_type, keywords in KEYWORD_PATTERNS.items():
                    for kw in keywords:
                        if kw in name1_lower or kw in name2_lower:
                            relation_type = rel_type
                            explanation = f"Found keyword '{kw}' indicating {rel_type}"
                            break
                    if relation_type != "related_to":
                        break
                
                # If still related_to, use category-based inference
                if relation_type == "related_to":
                    if c1.category and c2.category:
                        if c1.category == c2.category:
                            relation_type = "similar_to"
                            explanation = f"Same category: {c1.category}"
                        elif c1.category in ["method", "tool"] and c2.category in ["concept", "principle"]:
                            relation_type = "uses"
                            explanation = f"{c1.category} uses {c2.category}"
                        elif c1.category in ["concept", "principle"] and c2.category in ["method", "tool"]:
                            relation_type = "used_by"
                            explanation = f"{c2.name} uses {c1.name}"
                
                # Check importance scores for broader/narrower
                if relation_type == "related_to" and c1.importance_score and c2.importance_score:
                    diff = abs(c1.importance_score - c2.importance_score)
                    if diff > 0.2:
                        if c1.importance_score > c2.importance_score:
                            relation_type = "broader_than"
                            explanation = f"Higher importance score ({c1.importance_score:.2f} > {c2.importance_score:.2f})"
                        else:
                            relation_type = "narrower_than"
                            explanation = f"Lower importance score ({c1.importance_score:.2f} < {c2.importance_score:.2f})"
                
                # Create unique pair identifier
                pair_key = (c1.id, c2.id, relation_type)
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                
                relations.append(
                    RelationModel(
                        document_id=document_id,
                        source_concept_id=c1.id,
                        target_concept_id=c2.id,
                        relation_type=relation_type,
                        strength=strength,
                        evidence=evidence,
                        explanation=explanation or f"{c1.name} {relation_type} {c2.name}",
                    )
                )
        
        print(f"[RelationExtractor] Rule-based extracted {len(relations)} relations")
        return relations[:max_relations]


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
        from ..database import (
            get_chunks_by_ids,
            get_concepts,
            search_concepts_by_embedding,
        )
        from ..llm.models import QAResponse

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
