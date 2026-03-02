"""Tests for embeddings module."""

import pytest

from adler_graph_reader.embeddings.provider import (
    EmbeddingProvider,
    LocalEmbeddingProvider,
    LMStudioEmbeddingProvider,
    create_embedding_provider,
)


class TestLocalEmbeddingProvider:
    """Test LocalEmbeddingProvider functionality."""

    def test_init(self):
        """Test LocalEmbeddingProvider initialization."""
        provider = LocalEmbeddingProvider(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            device="cpu",
        )

        assert provider.model_name == "sentence-transformers/all-MiniLM-L6-v2"
        assert provider.device == "cpu"
        assert provider.normalize is True

    def test_detect_device(self):
        """Test device auto-detection."""
        provider = LocalEmbeddingProvider()
        device = provider._detect_device()

        # Should return one of: cuda, mps, cpu
        assert device in ("cuda", "mps", "cpu")


class TestLMStudioEmbeddingProvider:
    """Test LMStudioEmbeddingProvider functionality."""

    def test_init(self):
        """Test LMStudioEmbeddingProvider initialization."""
        provider = LMStudioEmbeddingProvider(
            base_url="http://localhost:1234/v1",
            model="qwen3-embedding-0.6b",
        )

        assert provider.base_url == "http://localhost:1234/v1"
        assert provider.model == "qwen3-embedding-0.6b"
        assert provider.timeout == 60.0


class TestEmbeddingProvider:
    """Test EmbeddingProvider dual-mode functionality."""

    def test_init_auto_mode(self):
        """Test EmbeddingProvider with auto mode."""
        provider = EmbeddingProvider(mode="auto")

        assert provider.mode == "auto"
        assert provider.lmstudio_provider is not None
        assert provider.local_provider is not None

    def test_init_local_mode(self):
        """Test EmbeddingProvider with local mode."""
        provider = EmbeddingProvider(mode="local")

        assert provider.mode == "local"
        assert provider.lmstudio_provider is None
        assert provider.local_provider is not None

    def test_init_lmstudio_mode(self):
        """Test EmbeddingProvider with lmstudio mode."""
        provider = EmbeddingProvider(mode="lmstudio")

        assert provider.mode == "lmstudio"
        assert provider.lmstudio_provider is not None
        assert provider.local_provider is None

    def test_invalid_mode_raises(self):
        """Test that invalid mode raises ValueError."""
        with pytest.raises(ValueError, match="Invalid mode"):
            EmbeddingProvider(mode="invalid")


class TestCreateEmbeddingProvider:
    """Test factory function."""

    def test_create_with_auto_mode(self):
        """Test creating provider with auto mode."""
        provider = create_embedding_provider(mode="auto")

        assert isinstance(provider, EmbeddingProvider)
        assert provider.mode == "auto"

    def test_create_with_custom_params(self):
        """Test creating provider with custom parameters."""
        provider = create_embedding_provider(
            mode="local",
            local_model="BAAI/bge-m3",
        )

        assert provider.mode == "local"
        assert provider.local_provider.model_name == "BAAI/bge-m3"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
