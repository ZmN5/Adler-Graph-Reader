#!/usr/bin/env python3
"""Test MLX model loading and inference."""

import os
from pathlib import Path
from mlx_lm import load, generate

# Load the 2B model - use absolute path
model_path = os.path.expanduser("~/.lmstudio/models/mlx-community/Qwen3.5-2B-5bit")
print(f"Loading model from {model_path}...")
print(f"Path exists: {os.path.exists(model_path)}")

# List files in the directory
if os.path.exists(model_path):
    print(f"Files: {os.listdir(model_path)[:5]}")

model, tokenizer = load(model_path)

# Test generation
prompt = "List 3 machine learning concepts:"
print(f"\nPrompt: {prompt}")
print("Generating...")

response = generate(
    model,
    tokenizer,
    prompt=prompt,
    max_tokens=100,
    temp=0.7,
)

print(f"Response: {response}")
print("\nMLX test completed successfully!")
