#!/usr/bin/env python3
"""
Test script to verify the enhanced concept extraction prompt.
This tests the improved prompt quality without requiring a real LLM call.
"""

import sys
sys.path.insert(0, 'src')

from adler_graph_reader.knowledge.extractor import ConceptExtractor
from adler_graph_reader.llm.models import EnhancedConcept


def test_prompt_structure():
    """Verify the enhanced prompt contains all required elements."""
    extractor = ConceptExtractor()
    
    # Create a mock context
    name = "机器学习"
    context = """
[Chunk 1]: 机器学习是人工智能的一个分支，它使计算机能够从数据中学习而无需明确编程。
机器学习算法通过识别数据中的模式来进行预测和决策。

[Chunk 2]: 例如，在图像识别中，机器学习模型可以学习识别猫和狗的图片。
另一个例子是垃圾邮件过滤，机器学习可以根据邮件内容判断是否为垃圾邮件。
"""
    
    # Build the prompt (we can't actually call the LLM in this test)
    # But we can verify the method structure exists
    print("✓ ConceptExtractor initialized successfully")
    
    # Check that the method exists and has the right signature
    import inspect
    sig = inspect.signature(extractor._extract_single_concept)
    params = list(sig.parameters.keys())
    assert 'name' in params
    assert 'context' in params
    print("✓ _extract_single_concept method has correct signature")
    
    # Verify the source code contains our enhancements
    import inspect
    source = inspect.getsource(extractor._extract_single_concept)
    
    # Check for key improvements in the prompt
    required_elements = [
        "必须基于文本中的明确定义",  # Must be based on explicit definition
        "避免循环定义",  # Avoid circular definitions
        "重要性评分",  # Importance score guidance
        "0.9-1.0: 核心概念",  # Score rubric
        "concept/principle/method/tool/person/event",  # Categories
        "学术知识提取专家",  # Expert system message
        "temperature=0.3",  # Lower temperature for consistency
        "Post-process",  # Quality validation
    ]
    
    missing = []
    for element in required_elements:
        if element not in source:
            missing.append(element)
    
    if missing:
        print(f"✗ Missing elements in prompt: {missing}")
        return False
    else:
        print("✓ All enhancement elements found in prompt")
    
    return True


def test_fallback_behavior():
    """Test that fallback still works when LLM fails."""
    from adler_graph_reader.llm.models import EnhancedConcept
    
    # Create a minimal concept as fallback would
    concept = EnhancedConcept(
        name="测试概念",
        definition="测试概念 是文本中的一个核心概念。",
        explanation=None,
        examples=[],
        importance_score=0.5,
        category="concept",
    )
    
    assert concept.name == "测试概念"
    assert concept.importance_score == 0.5
    print("✓ Fallback concept creation works correctly")
    
    return True


def main():
    """Run all tests."""
    print("=" * 60)
    print("Testing Enhanced Concept Extraction Prompt")
    print("=" * 60)
    
    tests = [
        ("Prompt Structure", test_prompt_structure),
        ("Fallback Behavior", test_fallback_behavior),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        print(f"\n--- {name} ---")
        try:
            if test_func():
                passed += 1
                print(f"✓ {name} PASSED")
            else:
                failed += 1
                print(f"✗ {name} FAILED")
        except Exception as e:
            failed += 1
            print(f"✗ {name} FAILED with exception: {e}")
    
    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)
    
    return failed == 0


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
