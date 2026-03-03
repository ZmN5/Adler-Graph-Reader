"""
LM Studio client for text generation and embeddings.
Uses OpenAI SDK with LM Studio's OpenAI-compatible API endpoint.
Supports fallback to OpenAI and Anthropic APIs when configured.
"""

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import httpx
import instructor
from openai import AsyncOpenAI, OpenAI
from openai import Timeout

from ..embeddings import EmbeddingProvider, create_embedding_provider
from .models import BookSummary, ConceptExtraction


class LLMBackend(Enum):
    """Supported LLM backends."""

    LM_STUDIO = "lmstudio"
    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


# Default LM Studio configuration
DEFAULT_BASE_URL = "http://localhost:1234/v1"
# Ollama configuration
OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen2.5:3b"
# Model configuration - can be overridden via environment variable ADLER_LLM_MODEL
# Default: qwen3.5-9b (must match the model loaded in LM Studio)
# Fallback models are tried in order if the primary fails
DEFAULT_MODEL = os.getenv("ADLER_LLM_MODEL", "qwen3.5-2b:2")
# Fallback models to try if primary fails
FALLBACK_MODELS = ["qwen3.5-35b-a3b"]
DEFAULT_EMBED_MODEL = (
    "text-embedding-nomic-embed-text-v1.5"  # Use a specific embedding model
)
DEFAULT_RERANK_MODEL = "qwen3-reranker-0.6b"  # Reranker model for result reranking
DEFAULT_TIMEOUT = 180.0  # Reduced timeout for faster feedback with small models
DEFAULT_ENABLE_THINKING = False  # Disable thinking for faster responses

# Environment variable names for API keys
ENV_OPENAI_API_KEY = "OPENAI_API_KEY"
ENV_ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY"
ENV_ADLER_LLM_BACKEND = "ADLER_LLM_BACKEND"  # lmstudio | ollama | openai | anthropic
ENV_OLLAMA_BASE_URL = "OLLAMA_BASE_URL"


def get_configured_backend() -> tuple[LLMBackend, str]:
    """
    Determine which LLM backend to use based on environment variables.

    Priority:
    1. If ADLER_LLM_BACKEND is set explicitly, use that
    2. If LM Studio is available (default base URL), use LM Studio
    3. If OLLAMA is configured, use OLLAMA
    4. If OPENAI_API_KEY is set, use OpenAI
    5. If ANTHROPIC_API_KEY is set, use Anthropic
    6. Default to LM Studio (may fail if not running)

    Returns:
        Tuple of (backend, api_key)
    """
    # Check explicit backend configuration
    explicit_backend = os.getenv(ENV_ADLER_LLM_BACKEND, "").lower()
    if explicit_backend:
        if explicit_backend == "openai":
            api_key = os.getenv(ENV_OPENAI_API_KEY, "")
            if api_key:
                return LLMBackend.OPENAI, api_key
            raise ValueError(
                f"ADLER_LLM_BACKEND=openai but {ENV_OPENAI_API_KEY} is not set"
            )
        elif explicit_backend == "anthropic":
            api_key = os.getenv(ENV_ANTHROPIC_API_KEY, "")
            if api_key:
                return LLMBackend.ANTHROPIC, api_key
            raise ValueError(
                f"ADLER_LLM_BACKEND=anthropic but {ENV_ANTHROPIC_API_KEY} is not set"
            )
        elif explicit_backend == "ollama":
            return LLMBackend.OLLAMA, "not-needed"
        elif explicit_backend == "lmstudio":
            return LLMBackend.LM_STUDIO, "not-needed"

    # Auto-detect based on available credentials
    # Priority: LM Studio > OLLAMA > OpenAI > Anthropic
    lm_studio_url = os.getenv("ADLER_LLM_BASE_URL", DEFAULT_BASE_URL)
    if lm_studio_url == DEFAULT_BASE_URL or lm_studio_url.startswith(
        "http://localhost:1234"
    ):
        # Assume LM Studio is intended if using default local URL
        return LLMBackend.LM_STUDIO, "not-needed"

    # Check for OLLAMA
    ollama_url = os.getenv(ENV_OLLAMA_BASE_URL, OLLAMA_BASE_URL)
    if ollama_url.startswith("http://localhost:11434"):
        return LLMBackend.OLLAMA, "not-needed"

    openai_key = os.getenv(ENV_OPENAI_API_KEY, "")
    if openai_key:
        return LLMBackend.OPENAI, openai_key

    anthropic_key = os.getenv(ENV_ANTHROPIC_API_KEY, "")
    if anthropic_key:
        return LLMBackend.ANTHROPIC, anthropic_key

    # Default to LM Studio
    return LLMBackend.LM_STUDIO, "not-needed"


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
    Client for interacting with LM Studio (or other OpenAI-compatible) API.
    Supports both synchronous and structured generation.

    Default configuration targets LM Studio at http://localhost:1234/v1
    Can be configured for Ollama or other compatible endpoints.

    Uses the new EmbeddingProvider for embeddings with dual-mode support
    (LM Studio API / local sentence-transformers / auto fallback).

    Now supports fallback to OpenAI and Anthropic APIs via environment variables:
    - Set ADLER_LLM_BACKEND=openai and OPENAI_API_KEY to use OpenAI
    - Set ADLER_LLM_BACKEND=anthropic and ANTHROPIC_API_KEY to use Anthropic
    - Defaults to LM Studio if no backend is explicitly configured
    """

    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL
    embed_model: str = DEFAULT_EMBED_MODEL
    embedding_mode: str = "lmstudio"  # "lmstudio", "local", or "auto"
    enable_thinking: bool = DEFAULT_ENABLE_THINKING  # Control model thinking process
    fallback_models: list = None  # List of fallback models to try
    _client: Optional[OpenAI] = None
    _struct_client: Optional[OpenAI] = None
    _async_client: Optional[AsyncOpenAI] = None
    _embedding_provider: Optional[EmbeddingProvider] = None
    _backend: LLMBackend = field(default=None, repr=False)
    _api_key: str = field(default="not-needed", repr=False)

    def __post_init__(self):
        """Initialize fallback models and detect backend."""
        if self.fallback_models is None:
            self.fallback_models = FALLBACK_MODELS.copy()

        # Detect backend configuration
        self._backend, self._api_key = get_configured_backend()

        # Update base_url and model based on backend
        if self._backend == LLMBackend.OPENAI:
            self.base_url = "https://api.openai.com/v1"
            # Use GPT-4o mini as default for OpenAI (cost-effective)
            if self.model == DEFAULT_MODEL:
                self.model = "gpt-4o-mini"
        elif self._backend == LLMBackend.ANTHROPIC:
            # Anthropic uses different client initialization
            self.base_url = "https://api.anthropic.com/v1"
            if self.model == DEFAULT_MODEL:
                self.model = "claude-3-haiku-20240307"
        elif self._backend == LLMBackend.OLLAMA:
            # OLLAMA uses OpenAI-compatible API at /v1 endpoint
            ollama_base = os.getenv(ENV_OLLAMA_BASE_URL, OLLAMA_BASE_URL)
            self.base_url = f"{ollama_base}/v1"
            if self.model == DEFAULT_MODEL:
                self.model = DEFAULT_OLLAMA_MODEL

    @property
    def backend(self) -> LLMBackend:
        """Get the currently configured backend."""
        return self._backend

    @property
    def client(self) -> OpenAI:
        """Lazy initialization of sync client for plain generation."""
        if self._client is None:
            self._client = OpenAI(
                base_url=self.base_url,
                api_key=self._api_key,
                timeout=Timeout(DEFAULT_TIMEOUT, connect=10.0),
                http_client=httpx.Client(trust_env=False),
            )
        return self._client

    @property
    def struct_client(self) -> OpenAI:
        """Lazy initialization of sync client for structured generation.

        Uses MD_JSON mode which is more compatible with LM Studio.
        This mode uses markdown-wrapped JSON responses instead of the
        OpenAI response_format parameter.
        """
        if self._struct_client is None:
            # For OpenAI/Anthropic, use JSON mode instead of MD_JSON
            mode = (
                instructor.Mode.JSON
                if self._backend in (LLMBackend.OPENAI, LLMBackend.ANTHROPIC)
                else instructor.Mode.MD_JSON
            )
            self._struct_client = instructor.from_openai(
                OpenAI(
                    base_url=self.base_url,
                    api_key=self._api_key,
                    timeout=Timeout(DEFAULT_TIMEOUT, connect=10.0),
                    http_client=httpx.Client(trust_env=False),
                ),
                mode=mode,
            )
        return self._struct_client

    @property
    def async_client(self) -> AsyncOpenAI:
        """Lazy initialization of async client with MD_JSON mode for LM Studio."""
        if self._async_client is None:
            mode = (
                instructor.Mode.JSON
                if self._backend in (LLMBackend.OPENAI, LLMBackend.ANTHROPIC)
                else instructor.Mode.MD_JSON
            )
            self._async_client = instructor.from_openai(
                AsyncOpenAI(
                    base_url=self.base_url,
                    api_key=self._api_key,
                    timeout=Timeout(DEFAULT_TIMEOUT, connect=10.0),
                ),
                mode=mode,
            )
        return self._async_client

    def _try_generate(
        self,
        model: str,
        messages: list,
        temperature: float,
        extra_body: dict,
    ) -> str:
        """Try to generate with a specific model."""
        # Skip extra_body for cloud providers (OpenAI/Anthropic don't support it)
        kwargs = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if self._backend == LLMBackend.LM_STUDIO and extra_body:
            kwargs["extra_body"] = extra_body

        response = self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
    ) -> str:
        """Generate text using the configured model with fallback support."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        # Build extra_body for thinking control (Qwen models) - only for LM Studio
        extra_body = {}
        if self._backend == LLMBackend.LM_STUDIO and not self.enable_thinking:
            # Try common parameter names for disabling thinking
            extra_body["enable_thinking"] = False
            extra_body["thinking"] = False

        # Try primary model first, then fallbacks (only for LM Studio)
        models_to_try = [self.model]
        if self._backend == LLMBackend.LM_STUDIO:
            models_to_try.extend(FALLBACK_MODELS)

        last_error = None

        for model in models_to_try:
            try:
                return self._try_generate(model, messages, temperature, extra_body)
            except Exception as e:
                last_error = e
                print(f"Model {model} failed: {e}")
                continue

        raise last_error

    def _try_generate_structured(
        self,
        model: str,
        messages: list,
        temperature: float,
        response_model: type,
        extra_body: dict,
    ) -> Any:
        """Try structured generation with a specific model."""
        kwargs = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "response_model": response_model,
        }
        if self._backend == LLMBackend.LM_STUDIO and extra_body:
            kwargs["extra_body"] = extra_body

        return self.struct_client.chat.completions.create(**kwargs)

    def generate_structured(
        self,
        prompt: str,
        response_model: type,
        system: Optional[str] = None,
        temperature: float = 0.7,
    ) -> Any:
        """Generate structured output using instructor with fallback support."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        # Build extra_body for thinking control (Qwen models) - only for LM Studio
        extra_body = {}
        if self._backend == LLMBackend.LM_STUDIO and not self.enable_thinking:
            # Try common parameter names for disabling thinking
            extra_body["enable_thinking"] = False
            extra_body["thinking"] = False

        # Try primary model first, then fallbacks (only for LM Studio)
        models_to_try = [self.model]
        if self._backend == LLMBackend.LM_STUDIO:
            models_to_try.extend(FALLBACK_MODELS)

        last_error = None

        for model in models_to_try:
            try:
                return self._try_generate_structured(
                    model, messages, temperature, response_model, extra_body
                )
            except Exception as e:
                last_error = e
                print(f"Model {model} failed for structured generation: {e}")
                continue

        raise last_error

    @property
    def embedding_provider(self) -> EmbeddingProvider:
        """Lazy initialization of embedding provider with dual-mode support."""
        if self._embedding_provider is None:
            self._embedding_provider = create_embedding_provider(
                mode=self.embedding_mode,
                lmstudio_url="http://localhost:1234/v1",
                lmstudio_model=self.embed_model,
            )
        return self._embedding_provider

    def embed(self, text: str, max_retries: int = 3) -> list[float]:
        """Generate embeddings using LM Studio API with fallback to embedding provider."""
        import time

        # For cloud providers, use their embedding API
        if self._backend == LLMBackend.OPENAI:
            for attempt in range(max_retries):
                try:
                    response = self.client.embeddings.create(
                        model="text-embedding-3-small",
                        input=text,
                    )
                    return response.data[0].embedding
                except Exception as e:
                    if attempt < max_retries - 1:
                        time.sleep(1)
                        continue
                    raise e

        # Use embedding provider directly (which uses httpx for LM Studio)
        return self.embedding_provider.embed(text, max_retries=max_retries)

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
    base_url: str = None,
    model: str = None,
    embed_model: str = None,
    embedding_mode: str = None,
    force_reset: bool = False,
) -> OllamaClient:
    """Get or create the default LLM client."""
    global _default_client

    # Force reset if requested or if environment variables differ
    if force_reset or _default_client is None:
        # Use environment variables or defaults
        base_url = base_url or os.getenv("ADLER_LLM_BASE_URL", DEFAULT_BASE_URL)
        model = model or os.getenv("ADLER_LLM_MODEL", DEFAULT_MODEL)
        embed_model = embed_model or os.getenv("ADLER_EMBED_MODEL", DEFAULT_EMBED_MODEL)
        embedding_mode = embedding_mode or os.getenv("ADLER_EMBEDDING_MODE", "lmstudio")

        _default_client = OllamaClient(
            base_url=base_url,
            model=model,
            embed_model=embed_model,
            embedding_mode=embedding_mode,
        )
    return _default_client


# Convenience functions
def summarize_book(
    chapters: list[dict], client: Optional[OllamaClient] = None
) -> BookSummary:
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

章节标题: {ch.get("title", "无标题")}
章节内容: {ch.get("content", "")[:2000]}...

请直接回答，不要有额外格式。"""
        summary = client.generate(prompt, temperature=0.5)
        chapter_summaries.append(
            {
                "title": ch.get("title", "无标题"),
                "summary": summary,
            }
        )

    # Reduce: Combine into book summary
    combined = "\n\n".join(
        [
            f"章节 {i + 1}: {s['title']}\n要点: {s['summary']}"
            for i, s in enumerate(chapter_summaries)
        ]
    )

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


def extract_concepts(
    context: str, client: Optional[OllamaClient] = None
) -> ConceptExtraction:
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
