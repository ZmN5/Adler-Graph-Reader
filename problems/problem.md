# SSE 流式输出问题总结

## 问题描述

后端 SSE 流式接口 `/api/nodes/{id}/summary/stream` 无法实现真正的流式展示，前端仍然一次性展示所有内容。

## 诊断结论（2026-04-05）

### 关键发现：问题定位到 LM Studio 或 reqwest HTTP/2 链路

**已确认正常的环节：**

| 环节 | 验证方式 | 结果 |
|------|----------|------|
| 后端 SSE 基础设施 | `curl -N http://localhost:8080/test/sse` | ✅ 立即逐字输出 |
| LM Studio 流式 API | `curl -N localhost:1234/v1/chat/completions ... stream: true` | ✅ 立即逐字输出 |
| 前端 React 渲染 | flushSync / ref+tick 模式 | ✅ 能接收流式数据 |
| Vite 代理 | 已配置 flushHeaders + x-accel-buffering | ✅ 不阻挡流 |

**已阻塞的环节：**

| 环节 | 现象 |
|------|------|
| Rust 后端 → LM Studio | curl 直连 LM Studio 能立即流式，但 Rust reqwest 请求 LM Studio 时要等 ~2000 token 才开始转发 |

### 已尝试的修复（均未生效）

1. **Vite 代理缓冲问题** — 配置了关闭缓冲，未生效
2. **后端 SSE KeepAlive** — 添加了 `.keep_alive()`，未生效
3. **前端 React flushSync** — 无效（async generator 中不触发）→ 改为 ref + tick 模式
4. **SSE 事件格式调整** — 部分生效（能收到数据），但未逐字显示
5. **后端添加 X-Accel-Buffering header** — 未生效
6. **reqwest 强制 http1_only()** — 待验证

### 可能的根因

1. **reqwest 0.12 HTTP/2 兼容性问题**：reqwest 默认尝试 HTTP/2，LM Studio 只支持 HTTP/1.1，降级过程可能导致响应被缓冲
2. **LM Studio Content-Length 头问题**：LM Studio 可能在 `stream: true` 模式下错误地返回了 `Content-Length` 头，导致 reqwest 认为需要等待完整 body
3. **reqwest bytes_stream 实现**：某些版本下 `bytes_stream()` 可能先等完整响应到达才开始 yield

### 待验证的检查点

```bash
# 1. 检查 reqwest http1_only() 是否解决问题
# 已修改 llm_client.rs 添加 .http1_only()

# 2. 检查 LM Studio 响应 headers
# 已在 llm_client.rs 添加 response.version(), content-type, transfer-encoding 日志

# 3. 用 Node.js/Python 写独立 HTTP 客户端测试
# 排除 reqwest 特有的行为
```

### 相关代码文件

| 文件 | 说明 |
|------|------|
| `backend/src/main.rs` | SSE endpoint `node_summary_stream` + `/test/sse` 诊断端点 |
| `backend/src/llm_client.rs` | LLM streaming 客户端（含诊断时间戳日志） |
| `frontend/src/lib/api-client.ts` | `getNodeSummaryStream` 函数 + 时间戳日志 |
| `frontend/src/components/NodeDetailPanel.tsx` | 流式内容渲染组件（ref + tick 模式） |
| `frontend/vite.config.ts` | Vite 代理配置（flushHeaders） |
