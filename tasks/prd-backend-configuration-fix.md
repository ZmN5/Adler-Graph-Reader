# PRD: 后端配置问题修复

## Introduction

修复后端服务中的四个配置/错误问题：
1. Extract 接口 400 错误信息不清晰
2. LM Studio API URL 硬编码不可配置
3. Chunk 大小超出模型上下文导致提取失败
4. 提取并发数硬编码不可配置

## Goals

- 改进错误提示，帮助用户快速定位问题
- 移除硬编码配置，改用环境变量
- 解决上下文超限错误，确保提取功能可用

## User Stories

### US-001: 改进 extract 接口错误提示
**Description:** 作为用户，我在调用 extract 接口时如果书籍未解析，能看到清晰的错误提示，而不是模糊的 400 Bad Request。

**Acceptance Criteria:**
- [ ] 错误消息明确说明：`"Book has no chunks. Please parse the book first via POST /api/books/{id}/parse."`
- [ ] 错误消息包含需要先调用哪个接口的信息
- [ ] 后端日志中能看到对应的警告

### US-002: LM Studio API URL 配置化
**Description:** 作为运维人员，我需要通过环境变量配置 LM Studio 的 API 地址，而不是修改代码。

**Acceptance Criteria:**
- [ ] 支持 `LLM_API_BASE_URL` 环境变量（如 `http://localhost:1234/v1`）
- [ ] 默认值为 `http://localhost:1234/v1`（保持向后兼容）
- [ ] 启动时读取环境变量，无运行时开销
- [ ] 日志中打印实际使用的 API 地址

### US-003: 提取并发数配置化
**Description:** 作为运维人员，我需要根据服务器性能调整 extract 操作的并发数。

**Acceptance Criteria:**
- [ ] 支持 `EXTRACT_CONCURRENCY` 环境变量（如 `4`）
- [ ] 默认值为 `4`（保持向后兼容）
- [ ] 并发控制使用信号量实现
- [ ] 日志中能看到并发数配置

### US-004: 修复 Context Length 错误
**Description:** 作为用户，我希望能成功提取书籍概念，不再出现上下文超限错误。

**Acceptance Criteria:**
- [ ] Chunk 大小从 16000 chars 减少到 8000 chars
- [ ] Split overlap 从 400 chars 减少到 200 chars
- [ ] 修改位于 `pdf_parser.rs:53` 和 `pdf_parser.rs:70`
- [ ] 重新 parse 的书籍使用新的 chunk 大小

## Functional Requirements

- **FR-1:** Extract 接口在书籍无 chunks 时返回 400，消息为 `"Book has no chunks. Please parse the book first via POST /api/books/{id}/parse."`
- **FR-2:** LlmClient 从 `LLM_API_BASE_URL` 环境变量读取 API 地址，默认 `http://localhost:1234/v1`
- **FR-3:** Extract 并发数从 `EXTRACT_CONCURRENCY` 环境变量读取，默认 `4`
- **FR-4:** PDF 解析时 chunk_size 改为 8000 chars，overlap 改为 200 chars

## Non-Goals

- 不修改前端界面
- 不修改 EPUB 解析器的 chunk 策略
- 不添加 metrics 或监控
- 不修改 LLM 模型选择逻辑（已有 `LLM_MODEL` 环境变量）

## Technical Considerations

### 文件修改
| 文件 | 修改内容 |
|------|----------|
| `backend/src/main.rs` | 改进 extract 400 错误消息 |
| `backend/src/extractor.rs` | 添加 `LLM_API_BASE_URL` 和 `EXTRACT_CONCURRENCY` 读取 |
| `backend/src/llm_client.rs` | 无修改（URL 通过 extractor 传入） |
| `backend/src/pdf_parser.rs` | chunk_size 8000, overlap 200 |

### Context 计算
- Chunk content: ~8000 chars ≈ 2000 tokens
- System prompt: ~500 tokens
- JSON Schema: ~300 tokens
- User prompt with content: ~2500 tokens
- **总计**: ~5300 tokens < 6000 tokens（模型上下文），留有安全余量

### 验证步骤
1. 重启后端服务
2. 确认日志显示：`Using LLM API: {URL}` 和 `Extract concurrency: {N}`
3. 找一个已 parse 的书，重新 parse（使用新的 chunk 大小）
4. 调用 extract 接口，确认成功完成
5. 确认日志中无 context length 错误

## Open Questions

无

## Success Metrics

- Extract 接口 400 错误发生时有清晰的错误消息
- LM Studio API 地址可通过环境变量配置
- 在 6000 token 上下文的模型上，extract 操作不再报 context length 错误
- 并发数可根据服务器性能调整
