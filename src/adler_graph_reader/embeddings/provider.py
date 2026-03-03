"""
Embedding provider with dual-mode support:
- LM Studio API (priority)
- Local sentence-transformers (fallback)
"""

from typing import Protocol, Optional


class EmbeddingBackend(Protocol):
    """Protocol for embedding backends."""

    def embed(self, text: str, max_retries: int = 3) -> list[float]:
        """Generate embedding for a single text."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        ...


class LMStudioEmbeddingProvider:
    """Embedding provider using LM Studio API with direct HTTP calls."""

    def __init__(
        self,
        base_url: str = "http://localhost:1234/v1",
        model: str = "text-embedding-nomic-embed-text-v1.5",
        timeout: float = 120.0,
    ):
        self.base_url = base_url
        self.model = model
        self.timeout = timeout

    def embed(self, text: str, max_retries: int = 3) -> list[float]:
        """Generate embedding using direct HTTP call with retry."""
        import time
        import requests

        last_error = None
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    f"{self.base_url}/embeddings",
                    json={"model": self.model, "input": text},
                    timeout=self.timeout,
                )
                response.raise_for_status()
                data = response.json()
                return data["data"][0]["embedding"]
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 2
                    print(
                        f"LM Studio embedding failed (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s..."
                    )
                    time.sleep(wait_time)
        raise RuntimeError(
            f"LM Studio embedding failed after {max_retries} attempts: {last_error}"
        )

    def embed_batch(self, texts: list[str], max_retries: int = 3) -> list[list[float]]:
        """Generate batch embeddings using direct HTTP call with retry."""
        import time
        import requests

        last_error = None
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    f"{self.base_url}/embeddings",
                    json={"model": self.model, "input": texts},
                    timeout=self.timeout,
                )
                response.raise_for_status()
                data = response.json()
                sorted_data = sorted(data["data"], key=lambda x: x["index"])
                return [item["embedding"] for item in sorted_data]
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 2
                    print(
                        f"LM Studio batch embedding failed (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s..."
                    )
                    time.sleep(wait_time)
        raise RuntimeError(
            f"LM Studio batch embedding failed after {max_retries} attempts: {last_error}"
        )


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

    def embed(self, text: str, max_retries: int = 3) -> list[float]:
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
        lmstudio_model: str = "text-embedding-nomic-embed-text-v1.5",
        local_model: str = "BAAI/bge-m3",
    ):
        if mode not in ("lmstudio", "local", "auto"):
            raise ValueError(
                f"Invalid mode: {mode}. Must be 'lmstudio', 'local', or 'auto'."
            )

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

    def embed(self, text: str, max_retries: int = 3) -> list[float]:
        """Generate embedding for a single text."""
        provider = self._get_active_provider()
        return provider.embed(text)

    def embed_batch(self, texts: list[str], max_retries: int = 3) -> list[list[float]]:
        """Generate embeddings for multiple texts with retry."""
        import time

        last_error = None
        for attempt in range(max_retries):
            try:
                provider = self._get_active_provider()
                return provider.embed_batch(texts)
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 3
                    print(
                        f"Batch embedding failed (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s..."
                    )
                    time.sleep(wait_time)
                    self._active_provider = None
        raise RuntimeError(
            f"Batch embedding failed after {max_retries} attempts: {last_error}"
        )

    def _get_active_provider(self) -> EmbeddingBackend:
        """Get the active provider, initializing if needed."""
        if self._active_provider is not None:
            return self._active_provider

        if self.mode == "local":
            if self.local_provider is None:
                self.local_provider = LocalEmbeddingProvider()
            self._active_provider = self.local_provider
            return self._active_provider

        # For "lmstudio" mode - use LM Studio with retry, no fallback
        if self.mode == "lmstudio" and self.lmstudio_provider is not None:
            import time

            max_retries = 3
            for attempt in range(max_retries):
                try:
                    self._active_provider = self.lmstudio_provider
                    return self._active_provider
                except Exception as e:
                    if attempt < max_retries - 1:
                        wait_time = (attempt + 1) * 2  # 2s, 4s
                        print(
                            f"LM Studio connection failed (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s..."
                        )
                        time.sleep(wait_time)
                    else:
                        raise RuntimeError(
                            f"LM Studio embedding failed after {max_retries} attempts: {e}"
                        )

        # For "auto" mode - try LM Studio first, then fallback
        if self.mode == "auto" and self.lmstudio_provider is not None:
            try:
                self._active_provider = self.lmstudio_provider
                return self._active_provider
            except Exception as e:
                print(f"LM Studio not available, falling back to local: {e}")
                self._fallback_occurred = True

        # Fallback to local only for "auto" mode
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
