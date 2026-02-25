"""
Ollama client for text generation and embeddings.
Uses OpenAI SDK with Ollama's v1 compatibility endpoint.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

import httpx
import instructor
from openai import AsyncOpenAI, OpenAI
from openai import Timeout

from .models import BookSummary, ConceptExtraction


# Default Ollama configuration
DEFAULT_BASE_URL = "http://localhost:11434/v1"
DEFAULT_MODEL = "qwen3:4b"
DEFAULT_EMBED_MODEL = "qwen3-embedding:0.6b"


class LLMProvider(ABC):
    """Abstract interface for LLM providers."""

    @abstractmethod
    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
    ) -> str:
        """Generate text from prompt."""
        pass

    @abstractmethod
    def generate_structured(
        self,
        prompt: str,
        response_model: type,
        system: Optional[str] = None,
        temperature: float = 0.7,
    ) -> Any:
        """Generate structured output using pydantic model."""
        pass

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        """Generate embeddings for text."""
        pass


@dataclass
class OllamaClient(LLMProvider):
    """
    Client for interacting with Ollama API.
    Supports both synchronous and structured generation.
    """

    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL
    embed_model: str = DEFAULT_EMBED_MODEL
    _client: Optional[OpenAI] = None
    _struct_client: Optional[OpenAI] = None
    _async_client: Optional[AsyncOpenAI] = None

    @property
    def client(self) -> OpenAI:
        """Lazy initialization of sync client for plain generation."""
        if self._client is None:
            self._client = OpenAI(
                base_url=self.base_url,
                api_key="not-needed",
                timeout=Timeout(60.0, connect=10.0),
                http_client=httpx.Client(trust_env=False),
            )
        return self._client

    @property
    def struct_client(self) -> OpenAI:
        """Lazy initialization of sync client for structured generation."""
        if self._struct_client is None:
            self._struct_client = instructor.from_openai(
                OpenAI(
                    base_url=self.base_url,
                    api_key="not-needed",
                    timeout=Timeout(60.0, connect=10.0),
                    http_client=httpx.Client(trust_env=False),
                ),
                mode=instructor.Mode.JSON,
            )
        return self._struct_client

    @property
    def async_client(self) -> AsyncOpenAI:
        """Lazy initialization of async client."""
        if self._async_client is None:
            self._async_client = instructor.from_openai(
                AsyncOpenAI(base_url=self.base_url, api_key="not-needed"),
                mode=instructor.Mode.JSON,
            )
        return self._async_client

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
    ) -> str:
        """Generate text using the configured model."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
        )

        return response.choices[0].message.content

    def generate_structured(
        self,
        prompt: str,
        response_model: type,
        system: Optional[str] = None,
        temperature: float = 0.7,
    ) -> Any:
        """Generate structured output using instructor."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        return self.struct_client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            response_model=response_model,
        )

    def embed(self, text: str, max_retries: int = 3) -> list[float]:
        """Generate embeddings using the embedding model with retry logic."""
        import time
        for attempt in range(max_retries):
            try:
                response = self.client.embeddings.create(
                    model=self.embed_model,
                    input=text,
                )
                return response.data[0].embedding
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(1)
                    continue
                raise e

    async def agenerate_structured(
        self,
        prompt: str,
        response_model: type,
        system: Optional[str] = None,
        temperature: float = 0.7,
    ) -> Any:
        """Async version of structured generation."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        return await self.async_client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            response_model=response_model,
        )


# Default client instance
_default_client: Optional[OllamaClient] = None


def get_default_client(
    base_url: str = DEFAULT_BASE_URL,
    model: str = DEFAULT_MODEL,
    embed_model: str = DEFAULT_EMBED_MODEL,
) -> OllamaClient:
    """Get or create the default LLM client."""
    global _default_client
    if _default_client is None:
        _default_client = OllamaClient(
            base_url=base_url,
            model=model,
            embed_model=embed_model,
        )
    return _default_client


# Convenience functions
def summarize_book(chapters: list[dict], client: Optional[OllamaClient] = None) -> BookSummary:
    """
    Map-Reduce style book summarization.
    1. Map: Generate summary for each chapter
    2. Reduce: Combine into book summary
    """
    if client is None:
        client = get_default_client()

    # Map: Summarize each chapter
    chapter_summaries = []
    for ch in chapters:
        prompt = f"""请阅读以下章节内容，然后用一句话总结本章的核心要点：

章节标题: {ch.get('title', '无标题')}
章节内容: {ch.get('content', '')[:2000]}...

请直接回答，不要有额外格式。"""
        summary = client.generate(prompt, temperature=0.5)
        chapter_summaries.append({
            "title": ch.get("title", "无标题"),
            "summary": summary,
        })

    # Reduce: Combine into book summary
    combined = "\n\n".join([
        f"章节 {i+1}: {s['title']}\n要点: {s['summary']}"
        for i, s in enumerate(chapter_summaries)
    ])

    prompt = f"""请根据以下各章摘要，总结这本书的整体内容：

{combined}

请提取：
1. 书籍分类/领域
2. 1-3句话的核心主旨
3. 书的整体大纲结构
4. 作者试图解决的核心问题

请严格按照指定格式输出。"""

    return client.generate_structured(
        prompt,
        response_model=BookSummary,
        system="你是一个专业的书籍分析专家，擅长提取书籍的核心论点和大纲结构。",
        temperature=0.3,
    )


def extract_concepts(context: str, client: Optional[OllamaClient] = None) -> ConceptExtraction:
    """
    Extract concepts from the given context using structured output.
    """
    if client is None:
        client = get_default_client()

    prompt = f"""请阅读以下上下文，提取关键概念及其定义和论证：

{context}

请识别：
1. 核心概念及其定义
2. 作者关于每个概念的核心论点
3. 论点的逻辑推导过程
4. 支撑的原文证据

请严格按照格式输出。"""

    return client.generate_structured(
        prompt,
        response_model=ConceptExtraction,
        system="你是一个专业的知识提取专家，擅长从文本中提取概念、定义和论证结构。",
        temperature=0.5,
    )
