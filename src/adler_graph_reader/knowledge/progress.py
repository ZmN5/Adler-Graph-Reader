"""
Progress persistence for long-running knowledge graph extraction tasks.

This module provides checkpoint-based progress tracking so that extraction
tasks can be resumed after interruption.
"""

import json
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class ExtractionStage(Enum):
    """Stages of the knowledge graph extraction pipeline."""

    NOT_STARTED = "not_started"
    THEMES_EXTRACTING = "themes_extracting"
    THEMES_COMPLETE = "themes_complete"
    CONCEPTS_EXTRACTING = "concepts_extracting"
    CONCEPTS_COMPLETE = "concepts_complete"
    RELATIONS_EXTRACTING = "relations_extracting"
    RELATIONS_COMPLETE = "relations_complete"
    COMPLETE = "complete"
    FAILED = "failed"


@dataclass
class ExtractionProgress:
    """Represents the current progress of an extraction task."""

    document_id: str
    stage: ExtractionStage = ExtractionStage.NOT_STARTED
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    # Theme extraction progress
    total_themes: int = 0
    extracted_themes: int = 0

    # Concept extraction progress
    total_concepts: int = 0
    extracted_concepts: int = 0
    concept_queue: list[str] = field(
        default_factory=list
    )  # Concepts waiting to be processed
    processed_concepts: list[str] = field(
        default_factory=list
    )  # Concepts already processed

    # Relation extraction progress
    total_relations: int = 0
    extracted_relations: int = 0

    # Error tracking
    errors: list[dict[str, Any]] = field(default_factory=list)
    last_error: Optional[str] = None

    # Metadata
    config: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert progress to dictionary for serialization."""
        return {
            "document_id": self.document_id,
            "stage": self.stage.value,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
            "total_themes": self.total_themes,
            "extracted_themes": self.extracted_themes,
            "total_concepts": self.total_concepts,
            "extracted_concepts": self.extracted_concepts,
            "concept_queue": json.dumps(self.concept_queue),
            "processed_concepts": json.dumps(self.processed_concepts),
            "total_relations": self.total_relations,
            "extracted_relations": self.extracted_relations,
            "errors": json.dumps(self.errors),
            "last_error": self.last_error,
            "config": json.dumps(self.config),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExtractionProgress":
        """Create progress from dictionary."""
        return cls(
            document_id=data["document_id"],
            stage=ExtractionStage(data.get("stage", "not_started")),
            started_at=data.get("started_at", time.time()),
            updated_at=data.get("updated_at", time.time()),
            total_themes=data.get("total_themes", 0),
            extracted_themes=data.get("extracted_themes", 0),
            total_concepts=data.get("total_concepts", 0),
            extracted_concepts=data.get("extracted_concepts", 0),
            concept_queue=json.loads(data.get("concept_queue", "[]")),
            processed_concepts=json.loads(data.get("processed_concepts", "[]")),
            total_relations=data.get("total_relations", 0),
            extracted_relations=data.get("extracted_relations", 0),
            errors=json.loads(data.get("errors", "[]")),
            last_error=data.get("last_error"),
            config=json.loads(data.get("config", "{}")),
        )

    @property
    def is_complete(self) -> bool:
        """Check if extraction is complete."""
        return self.stage == ExtractionStage.COMPLETE

    @property
    def can_resume(self) -> bool:
        """Check if extraction can be resumed."""
        return self.stage not in [ExtractionStage.NOT_STARTED, ExtractionStage.COMPLETE]

    @property
    def progress_percent(self) -> float:
        """Calculate overall progress percentage."""
        weights = {
            ExtractionStage.THEMES_COMPLETE: 0.2,
            ExtractionStage.CONCEPTS_COMPLETE: 0.6,
            ExtractionStage.RELATIONS_COMPLETE: 0.2,
        }

        stage_progress = 0.0
        if self.stage.value >= ExtractionStage.THEMES_COMPLETE.value:
            stage_progress += weights[ExtractionStage.THEMES_COMPLETE]
        if self.stage.value >= ExtractionStage.CONCEPTS_COMPLETE.value:
            stage_progress += weights[ExtractionStage.CONCEPTS_COMPLETE]
        if self.stage.value >= ExtractionStage.RELATIONS_COMPLETE.value:
            stage_progress += weights[ExtractionStage.RELATIONS_COMPLETE]

        # Add partial progress within current stage
        if self.stage == ExtractionStage.THEMES_EXTRACTING and self.total_themes > 0:
            stage_progress += (self.extracted_themes / self.total_themes) * weights[
                ExtractionStage.THEMES_COMPLETE
            ]
        elif (
            self.stage == ExtractionStage.CONCEPTS_EXTRACTING
            and self.total_concepts > 0
        ):
            stage_progress += (self.extracted_concepts / self.total_concepts) * weights[
                ExtractionStage.CONCEPTS_COMPLETE
            ]
        elif (
            self.stage == ExtractionStage.RELATIONS_EXTRACTING
            and self.total_relations > 0
        ):
            stage_progress += (
                self.extracted_relations / self.total_relations
            ) * weights[ExtractionStage.RELATIONS_COMPLETE]

        return stage_progress * 100

    def add_error(self, error: str, context: Optional[str] = None) -> None:
        """Add an error to the error log."""
        self.errors.append(
            {
                "error": error,
                "context": context,
                "timestamp": time.time(),
            }
        )
        self.last_error = error
        self.updated_at = time.time()

    def mark_concept_processed(self, concept_name: str) -> None:
        """Mark a concept as processed."""
        if concept_name in self.concept_queue:
            self.concept_queue.remove(concept_name)
        if concept_name not in self.processed_concepts:
            self.processed_concepts.append(concept_name)
        self.extracted_concepts = len(self.processed_concepts)
        self.updated_at = time.time()

    def get_next_concept(self) -> Optional[str]:
        """Get the next concept to process."""
        if self.concept_queue:
            return self.concept_queue[0]
        return None


class ProgressManager:
    """Manage progress persistence for extraction tasks."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self._ensure_table()

    def _ensure_table(self) -> None:
        """Create the progress tracking table if it doesn't exist."""
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS extraction_progress (
                document_id TEXT PRIMARY KEY,
                stage TEXT NOT NULL DEFAULT 'not_started',
                started_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                total_themes INTEGER DEFAULT 0,
                extracted_themes INTEGER DEFAULT 0,
                total_concepts INTEGER DEFAULT 0,
                extracted_concepts INTEGER DEFAULT 0,
                concept_queue TEXT DEFAULT '[]',
                processed_concepts TEXT DEFAULT '[]',
                total_relations INTEGER DEFAULT 0,
                extracted_relations INTEGER DEFAULT 0,
                errors TEXT DEFAULT '[]',
                last_error TEXT,
                config TEXT DEFAULT '{}'
            )
        """)
        self.conn.commit()

    def save_progress(self, progress: ExtractionProgress) -> None:
        """Save progress to database."""
        progress.updated_at = time.time()
        data = progress.to_dict()

        self.conn.execute(
            """
            INSERT OR REPLACE INTO extraction_progress 
            (document_id, stage, started_at, updated_at, total_themes, extracted_themes,
             total_concepts, extracted_concepts, concept_queue, processed_concepts,
             total_relations, extracted_relations, errors, last_error, config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                data["document_id"],
                data["stage"],
                data["started_at"],
                data["updated_at"],
                data["total_themes"],
                data["extracted_themes"],
                data["total_concepts"],
                data["extracted_concepts"],
                data["concept_queue"],
                data["processed_concepts"],
                data["total_relations"],
                data["extracted_relations"],
                data["errors"],
                data["last_error"],
                data["config"],
            ),
        )
        self.conn.commit()

    def load_progress(self, document_id: str) -> Optional[ExtractionProgress]:
        """Load progress from database."""
        cursor = self.conn.execute(
            "SELECT * FROM extraction_progress WHERE document_id = ?", (document_id,)
        )
        row = cursor.fetchone()
        if row:
            columns = [desc[0] for desc in cursor.description]
            data = dict(zip(columns, row))
            return ExtractionProgress.from_dict(data)
        return None

    def create_progress(
        self, document_id: str, config: Optional[dict] = None
    ) -> ExtractionProgress:
        """Create new progress tracking for a document."""
        progress = ExtractionProgress(
            document_id=document_id,
            stage=ExtractionStage.NOT_STARTED,
            config=config or {},
        )
        self.save_progress(progress)
        return progress

    def delete_progress(self, document_id: str) -> None:
        """Delete progress tracking for a document."""
        self.conn.execute(
            "DELETE FROM extraction_progress WHERE document_id = ?", (document_id,)
        )
        self.conn.commit()

    def list_progress(self) -> list[ExtractionProgress]:
        """List all progress records."""
        cursor = self.conn.execute("SELECT * FROM extraction_progress")
        columns = [desc[0] for desc in cursor.description]
        results = []
        for row in cursor.fetchall():
            data = dict(zip(columns, row))
            results.append(ExtractionProgress.from_dict(data))
        return results

    def get_stalled_tasks(
        self, threshold_seconds: int = 3600
    ) -> list[ExtractionProgress]:
        """Get tasks that haven't been updated recently (potentially stalled)."""
        threshold = time.time() - threshold_seconds
        cursor = self.conn.execute(
            "SELECT * FROM extraction_progress WHERE updated_at < ? AND stage NOT IN (?, ?)",
            (
                threshold,
                ExtractionStage.COMPLETE.value,
                ExtractionStage.NOT_STARTED.value,
            ),
        )
        columns = [desc[0] for desc in cursor.description]
        results = []
        for row in cursor.fetchall():
            data = dict(zip(columns, row))
            results.append(ExtractionProgress.from_dict(data))
        return results


def format_progress_report(progress: ExtractionProgress) -> str:
    """Format a human-readable progress report."""
    lines = [
        f"📊 提取进度报告 - {progress.document_id}",
        f"   阶段：{progress.stage.value}",
        f"   开始时间：{datetime.fromtimestamp(progress.started_at).strftime('%Y-%m-%d %H:%M:%S')}",
        f"   最后更新：{datetime.fromtimestamp(progress.updated_at).strftime('%Y-%m-%d %H:%M:%S')}",
        f"   总进度：{progress.progress_percent:.1f}%",
        "",
    ]

    if progress.stage.value >= ExtractionStage.THEMES_EXTRACTING.value:
        lines.append(
            f"📌 主题提取：{progress.extracted_themes}/{progress.total_themes}"
        )

    if progress.stage.value >= ExtractionStage.CONCEPTS_EXTRACTING.value:
        lines.append(
            f"💡 概念提取：{progress.extracted_concepts}/{progress.total_concepts}"
        )
        if progress.concept_queue:
            remaining = len(progress.concept_queue)
            lines.append(f"   待处理：{remaining} 个概念")

    if progress.stage.value >= ExtractionStage.RELATIONS_EXTRACTING.value:
        lines.append(
            f"🔗 关系提取：{progress.extracted_relations}/{progress.total_relations}"
        )

    if progress.errors:
        lines.append("")
        lines.append(f"⚠️ 错误数量：{len(progress.errors)}")
        if progress.last_error:
            lines.append(f"   最后错误：{progress.last_error[:100]}")

    return "\n".join(lines)
