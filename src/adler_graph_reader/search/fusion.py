"""
Reciprocal Rank Fusion (RRF) for combining search results.
"""

from collections import defaultdict
from typing import Any


RRF_K = 60  # Standard RRF constant


def rrf_fusion(
    *result_lists: list[dict[str, Any]],
    k: int = RRF_K,
) -> list[dict[str, Any]]:
    """
    Combine multiple ranked lists using Reciprocal Rank Fusion.

    Formula: Score = sum(1 / (k + rank)) for each list

    Args:
        *result_lists: Variable number of ranked result lists
        k: RRF constant (default 60)

    Returns:
        Fused and re-ranked results
    """
    if not result_lists:
        return []

    # Collect all unique IDs and their scores
    scores: dict[int, float] = defaultdict(float)

    for result_list in result_lists:
        for rank, result in enumerate(result_list, start=1):
            tree_id = result.get("tree_id")
            if tree_id is not None:
                scores[tree_id] += 1.0 / (k + rank)

    # Sort by combined score
    fused = [
        {"tree_id": tree_id, "rrf_score": score}
        for tree_id, score in scores.items()
    ]
    fused.sort(key=lambda x: x["rrf_score"], reverse=True)

    return fused
