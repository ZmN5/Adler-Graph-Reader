"""
Embedding provider with dual-mode support:
- LM Studio API (priority)
- Local sentence-transformers (fallback)
"""
from typing import Protocol, Optional


class EmbeddingBackend(Protocol):
    """Protocol for embedding backends."""

    def embed(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        ...


class LMStudioEmbeddingProvider:
    """Embedding provider using LM Studio API."""

    def __init__(
        self,
        base_url: str = "http://localhost:1234/v1",
        model: str = "qwen3-embedding-0.6b",
        timeout: float = 60.0,
    ):
        self.base_url = base_url
        self.model = model
        self.timeout = timeout
        self._client: Optional[object] = None

    def _get_client(self):
        """Lazy initialization of OpenAI client."""
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(
                base_url=self.base_url,
                api_key="not-needed",
                timeout=self.timeout,
            )
        return self._client

    def embed(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        response = self._get_client().embeddings.create(
            model=self.model,
            input=text,
        )
        return response.data[0].embedding

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        response = self._get_client().embeddings.create(
            model=self.model,
            input=texts,
        )
        # Sort by index to ensure correct order
        sorted_data = sorted(response.data, key=lambda x: x.index)
        return [item.embedding for item in sorted_data]


class LocalEmbeddingProvider:
    """Local embedding provider using sentence-transformers."""

    def __init__(
        self,
        model_name: str = "BAAI/bge-m3",
        device: Optional[str] = None,
        normalize: bool = True,
    ):
        self.model_name = model_name
        self.normalize = normalize
        self.device = device or self._detect_device()
        self._model = None

    def _detect_device(self) -> str:
        """Auto-detect best available device."""
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
            elif torch.backends.mps.is_available():
                return "mps"
        except ImportError:
            pass
        return "cpu"

    def _get_model(self):
        """Lazy load the sentence-transformer model."""
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name, device=self.device)
        return self._model

    def embed(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        model = self._get_model()
        embedding = model.encode(text, normalize_embeddings=self.normalize)
        return embedding.tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        model = self._get_model()
        embeddings = model.encode(
            texts,
            normalize_embeddings=self.normalize,
            batch_size=8,
            show_progress_bar=False,
        )
        return embeddings.tolist()


class EmbeddingProvider:
    """
    Dual-mode embedding provider with automatic fallback.

    Mode:
    - "lmstudio": Use LM Studio API only
    - "local": Use sentence-transformers only
    - "auto": Try LM Studio first, fallback to local on failure
    """

    def __init__(
        self,
        mode: str = "auto",
        lmstudio_url: str = "http://localhost:1234/v1",
        lmstudio_model: str = "qwen3-embedding-0.6b",
        local_model: str = "BAAI/bge-m3",
    ):
        if mode not in ("lmstudio", "local", "auto"):
            raise ValueError(f"Invalid mode: {mode}. Must be 'lmstudio', 'local', or 'auto'.")

        self.mode = mode
        self.lmstudio_provider: Optional[LMStudioEmbeddingProvider] = None
        self.local_provider: Optional[LocalEmbeddingProvider] = None
        self._active_provider: Optional[EmbeddingBackend] = None
        self._fallback_occurred = False

        # Initialize providers based on mode
        if mode in ("lmstudio", "auto"):
            self.lmstudio_provider = LMStudioEmbeddingProvider(
                base_url=lmstudio_url,
                model=lmstudio_model,
            )

        if mode in ("local", "auto"):
            self.local_provider = LocalEmbeddingProvider(model_name=local_model)

    @property
    def embedding_dim(self) -> int:
        """Get embedding dimension."""
        # Default dimensions for common models
        if self._active_provider is not None:
            # Try to get from model if possible
            return 1024  # Default for qwen3-embedding-0.6b
        return 1024

    def embed(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        provider = self._get_active_provider()
        return provider.embed(text)

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        provider = self._get_active_provider()
        return provider.embed_batch(texts)

    def _get_active_provider(self) -> EmbeddingBackend:
        """Get the active provider, initializing if needed."""
        if self._active_provider is not None:
            return self._active_provider

        if self.mode == "local":
            if self.local_provider is None:
                self.local_provider = LocalEmbeddingProvider()
            self._active_provider = self.local_provider
            return self._active_provider

        # For "auto" or "lmstudio" mode
        if self.lmstudio_provider is not None:
            try:
                # Test if LM Studio is available
                self.lmstudio_provider.embed("test")
                self._active_provider = self.lmstudio_provider
                return self._active_provider
            except Exception as e:
                print(f"LM Studio not available: {e}")
                self._fallback_occurred = True

        # Fallback to local
        if self.local_provider is None:
            self.local_provider = LocalEmbeddingProvider()
        self._active_provider = self.local_provider
        self._fallback_occurred = True
        return self._active_provider


def create_embedding_provider(
    mode: str = "auto",
    **kwargs,
) -> EmbeddingProvider:
    """
    Factory function to create an embedding provider.

    Args:
        mode: "lmstudio", "local", or "auto"
        **kwargs: Additional arguments passed to EmbeddingProvider

    Returns:
        EmbeddingProvider instance
    """
    return EmbeddingProvider(mode=mode, **kwargs)