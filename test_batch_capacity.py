"""Test batch request capacity for LM Studio"""

import asyncio
import time
from openai import AsyncOpenAI

async def test_single_request(client, prompt, timeout=60):
    """Test a single request"""
    try:
        response = await client.chat.completions.create(
            model="local",
            messages=[{"role": "user", "content": prompt}],
            timeout=timeout,
            extra_body={"enable_thinking": False, "thinking": False},
        )
        return True, response.choices[0].message.content[:50]
    except Exception as e:
        return False, str(e)

async def test_concurrent_requests(num_requests=5):
    """Test concurrent requests"""
    client = AsyncOpenAI(
        base_url="http://localhost:1234/v1",
        api_key="not-needed",
    )

    prompts = [f"Test prompt {i}: What is machine learning?" for i in range(num_requests)]

    print(f"Testing {num_requests} concurrent requests...")
    start_time = time.time()

    tasks = [test_single_request(client, p) for p in prompts]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.time() - start_time
    success_count = sum(1 for r in results if isinstance(r, tuple) and r[0])

    print(f"\nResults:")
    print(f"  Total requests: {num_requests}")
    print(f"  Successful: {success_count}")
    print(f"  Failed: {num_requests - success_count}")
    print(f"  Total time: {elapsed:.2f}s")
    print(f"  Avg time per request: {elapsed/num_requests:.2f}s")

    return success_count == num_requests

async def find_max_capacity():
    """Find maximum concurrent requests"""
    print("=" * 60)
    print("LM Studio Batch Request Capacity Test")
    print("=" * 60)

    # Test increasing batch sizes
    for batch_size in [1, 2, 3, 5, 8]:
        print(f"\n--- Testing batch size: {batch_size} ---")
        success = await test_concurrent_requests(batch_size)
        if not success:
            print(f"❌ Batch size {batch_size} failed!")
            print(f"✅ Recommended max batch size: {batch_size - 1}")
            return batch_size - 1
        await asyncio.sleep(2)  # Cool down between tests

    print(f"\n✅ All tested batch sizes passed!")
    return 8

if __name__ == "__main__":
    max_capacity = asyncio.run(find_max_capacity())
    print(f"\n{'='*60}")
    print(f"Recommended max concurrent requests: {max_capacity}")
    print(f"{'='*60}")
