"""Configuration management for Adler-Graph-Reader."""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Config:
    """Global configuration for Adler-Graph-Reader."""

    # Language setting (default: Chinese)
    language: str = field(default="zh")

    # Available languages
    SUPPORTED_LANGUAGES = {"zh": "中文", "en": "English", "ja": "日本語"}

    def __post_init__(self):
        """Validate language setting."""
        if self.language not in self.SUPPORTED_LANGUAGES:
            print(f"Warning: Unsupported language '{self.language}', falling back to 'zh'")
            self.language = "zh"

    @classmethod
    def from_env(cls) -> "Config":
        """Create config from environment variables."""
        return cls(
            language=os.getenv("ADLER_LANGUAGE", "zh"),
        )

    def get_language_name(self) -> str:
        """Get human-readable language name."""
        return self.SUPPORTED_LANGUAGES.get(self.language, "Unknown")

    def get_prompt_suffix(self) -> str:
        """Get prompt suffix for language instruction."""
        prompts = {
            "zh": "请用中文回答。",
            "en": "Please answer in English.",
            "ja": "日本語で答えてください。",
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
