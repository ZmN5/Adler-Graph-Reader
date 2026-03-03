#!/bin/bash
# Adler-Graph-Reader Quick Start Script
# This script initializes the database and verifies LLM connectivity

set -e

echo "=========================================="
echo "  Adler-Graph-Reader Quick Start"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "pyproject.toml" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

# Step 1: Initialize Database
echo -e "${YELLOW}[Step 1/3] Initializing database...${NC}"
python -c "
from adler_graph_reader.database.connection import init_db
init_db()
print('✓ Database initialized successfully')
"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database initialized${NC}"
else
    echo -e "${RED}✗ Failed to initialize database${NC}"
    exit 1
fi
echo ""

# Step 2: Check LLM Configuration
echo -e "${YELLOW}[Step 2/3] Checking LLM configuration...${NC}"

# Check environment variables
BACKEND=${ADLER_LLM_BACKEND:-"lmstudio"}
OPENAI_KEY=${OPENAI_API_KEY:-""}
ANTHROPIC_KEY=${ANTHROPIC_API_KEY:-""}

echo "  Backend preference: $BACKEND"

if [ "$BACKEND" = "openai" ] && [ -n "$OPENAI_KEY" ]; then
    echo -e "${GREEN}  ✓ OpenAI API key configured${NC}"
    USING_BACKEND="openai"
elif [ "$BACKEND" = "anthropic" ] && [ -n "$ANTHROPIC_KEY" ]; then
    echo -e "${GREEN}  ✓ Anthropic API key configured${NC}"
    USING_BACKEND="anthropic"
else
    echo "  Using LM Studio (local)"
    USING_BACKEND="lmstudio"
fi
echo ""

# Step 3: Verify LLM Connection
echo -e "${YELLOW}[Step 3/3] Verifying LLM connection...${NC}"

python -c "
import os
import sys

# Import after setting up path
from adler_graph_reader.llm.client import get_default_client, LLMBackend

try:
    client = get_default_client()
    backend = client.backend
    
    if backend == LLMBackend.OPENAI:
        print('✓ Using OpenAI API')
        print(f'  Model: {client.model}')
    elif backend == LLMBackend.ANTHROPIC:
        print('✓ Using Anthropic API')
        print(f'  Model: {client.model}')
    else:
        print('✓ Using LM Studio (local)')
        print(f'  Base URL: {client.base_url}')
        print(f'  Model: {client.model}')
    
    # Test simple generation
    print('\n  Testing connection...')
    response = client.generate('Say \"Hello from Adler\"', temperature=0)
    print(f'  ✓ LLM responded: {response[:50]}...')
    
except Exception as e:
    print(f'✗ Connection failed: {e}')
    sys.exit(1)
"

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}==========================================${NC}"
    echo -e "${RED}  LLM Connection Failed${NC}"
    echo -e "${RED}==========================================${NC}"
    echo ""
    echo "Troubleshooting:"
    if [ "$USING_BACKEND" = "lmstudio" ]; then
        echo "  1. Make sure LM Studio is running"
        echo "     Download: https://lmstudio.ai/"
        echo "  2. Load a model in LM Studio (e.g., qwen3.5-9b)"
        echo "  3. Start the local server on port 1234"
        echo ""
        echo "Alternative: Use OpenAI API instead:"
        echo "  export ADLER_LLM_BACKEND=openai"
        echo "  export OPENAI_API_KEY=your-key-here"
    else
        echo "  1. Check your API key is correct"
        echo "  2. Verify you have internet connectivity"
        echo "  3. Check the API service status"
    fi
    exit 1
fi

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}  Ready to go!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "Quick commands:"
echo "  uv run adler --help          # Show all commands"
echo "  uv run adler ingest <file>   # Import a PDF/EPUB"
echo "  uv run adler build-graph     # Build knowledge graph"
echo "  uv run adler api             # Start API server"
echo ""
echo "Documentation: README.md"
echo ""
