"""Configuration management for Adler-Graph-Reader."""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Config:
    """Global configuration for Adler-Graph-Reader."""

    # Language setting (default: Chinese)
    language: str = field(default="en")

    # LLM Model configuration
    # Default: qwen3.5-2b (loaded in LM Studio)
    # Fallback order: qwen3.5-2b -> qwen3.5-9b -> qwen3.5-35b-a3b
    # Can be overridden via ADLER_LLM_MODEL environment variable
    llm_model: str = field(default="qwen3.5-2b")

    # LM Studio base URL
    # Can be overridden via ADLER_LLM_BASE_URL environment variable
    llm_base_url: str = field(default="http://localhost:1234/v1")

    # Embedding model configuration
    # Default: qwen3-embedding-0.6b (supports up to 6k tokens)
    # Can be overridden via ADLER_EMBEDDING_MODEL environment variable
    embedding_model: str = field(default="qwen3-embedding-0.6b")
    embedding_base_url: str = field(default="http://localhost:1234/v1")
    # Max input tokens for embedding model (default 6k for qwen3-embedding)
    embedding_max_tokens: int = field(default=6000)

    # Available languages (Chinese and English only)
    SUPPORTED_LANGUAGES = {"zh": "中文", "en": "English"}

    def __post_init__(self):
        """Validate language setting."""
        if self.language not in self.SUPPORTED_LANGUAGES:
            print(
                f"Warning: Unsupported language '{self.language}', falling back to 'zh'"
            )
            self.language = "zh"

    @classmethod
    def from_env(cls) -> "Config":
        """Create config from environment variables."""
        return cls(
            language=os.getenv("ADLER_LANGUAGE", "en"),
            llm_model=os.getenv("ADLER_LLM_MODEL", "qwen3.5-2b"),
            llm_base_url=os.getenv("ADLER_LLM_BASE_URL", "http://localhost:1234/v1"),
            embedding_model=os.getenv("ADLER_EMBEDDING_MODEL", "qwen3-embedding-0.6b"),
            embedding_base_url=os.getenv("ADLER_EMBEDDING_BASE_URL", "http://localhost:1234/v1"),
            embedding_max_tokens=int(os.getenv("ADLER_EMBEDDING_MAX_TOKENS", "6000")),
        )

    def get_language_name(self) -> str:
        """Get human-readable language name."""
        return self.SUPPORTED_LANGUAGES.get(self.language, "Unknown")

    def get_prompt_suffix(self) -> str:
        """Get prompt suffix for language instruction."""
        prompts = {
            "zh": "请用中文回答。",
            "en": "Please answer in English.",
        }
        return prompts.get(self.language, prompts["zh"])


# Global config instance
_config: Optional[Config] = None


def get_config() -> Config:
    """Get global configuration instance."""
    global _config
    if _config is None:
        _config = Config.from_env()
    return _config


def set_config(config: Config) -> None:
    """Set global configuration instance."""
    global _config
    _config = config


def set_language(language: str) -> None:
    """Set language for global config."""
    config = get_config()
    config.language = language
