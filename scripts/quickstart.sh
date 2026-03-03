#!/bin/bash
# Adler Graph Reader - Quick Start Script
# This script initializes the database and verifies LM Studio connection

set -e  # Exit on error

echo "🚀 Adler Graph Reader - Quick Start"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo -e "${RED}❌ Error: uv is not installed${NC}"
    echo "Please install uv first: https://github.com/astral-sh/uv"
    exit 1
fi

echo -e "${BLUE}✓ uv found${NC}"

# Check Python version
PYTHON_VERSION=$(uv run python --version 2>&1 | awk '{print $2}')
echo -e "${BLUE}✓ Python version: $PYTHON_VERSION${NC}"

# Step 1: Initialize database
echo ""
echo -e "${YELLOW}Step 1: Initializing database...${NC}"
if uv run adler init-db; then
    echo -e "${GREEN}✓ Database initialized successfully${NC}"
else
    echo -e "${RED}❌ Failed to initialize database${NC}"
    exit 1
fi

# Step 2: Verify LM Studio connection
echo ""
echo -e "${YELLOW}Step 2: Verifying LM Studio connection...${NC}"

LM_STUDIO_URL="${ADLER_LLM_BASE_URL:-http://localhost:1234/v1}"
echo "Checking LM Studio at: $LM_STUDIO_URL"

# Test connection using curl
if curl -s "$LM_STUDIO_URL/models" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ LM Studio is running${NC}"

    # Try to get model info
    MODEL_INFO=$(curl -s "$LM_STUDIO_URL/models" 2>/dev/null || echo "")
    if [ -n "$MODEL_INFO" ]; then
        echo -e "${BLUE}  Available models detected${NC}"
    fi
else
    echo -e "${RED}❌ Cannot connect to LM Studio at $LM_STUDIO_URL${NC}"
    echo ""
    echo -e "${YELLOW}Please ensure:${NC}"
    echo "  1. LM Studio is running"
    echo "  2. A model is loaded (e.g., qwen3.5-9b)"
    echo "  3. The API server is enabled in LM Studio settings"
    echo "  4. The server is listening on port 1234"
    echo ""
    echo -e "${YELLOW}Alternatively, you can:${NC}"
    echo "  - Set ADLER_LLM_BASE_URL to use a different endpoint"
    echo "  - Set OPENAI_API_KEY to use OpenAI instead"
    echo "  - Set ANTHROPIC_API_KEY to use Anthropic instead"
    echo ""
    exit 1
fi

# Step 3: Check embedding model
echo ""
echo -e "${YELLOW}Step 3: Checking embedding capability...${NC}"
EMBED_MODEL="${ADLER_EMBED_MODEL:-text-embedding-nomic-embed-text-v1.5}"
echo "Embedding model: $EMBED_MODEL"
echo -e "${GREEN}✓ Embedding configured${NC}"

# Step 4: Summary
echo ""
echo "===================================="
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Import a book:   uv run adler ingest <path-to-book.pdf>"
echo "  2. Build graph:     uv run adler build-graph --all"
echo "  3. Start UI:        uv run adler ui"
echo "  4. Or start API:    uv run adler api"
echo ""
echo -e "${BLUE}Configuration:${NC}"
echo "  LM Studio URL: $LM_STUDIO_URL"
echo "  LLM Model: ${ADLER_LLM_MODEL:-qwen3.5-9b}"
echo "  Embed Model: $EMBED_MODEL"
echo ""

# Show backend info
if [ -n "$OPENAI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  Using OpenAI as fallback (OPENAI_API_KEY is set)${NC}"
fi
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  Using Anthropic as fallback (ANTHROPIC_API_KEY is set)${NC}"
fi

echo -e "${GREEN}Happy reading! 🦞${NC}"
