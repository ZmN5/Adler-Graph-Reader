# 项目评估报告

**评估日期**: 2026-03-28
**评估范围**: 功能完整性、代码质量、配置正确性、前后端集成

---

## 一、概述

项目为"智能阅读概念图谱系统"(Intelligent Reading Concept Graph)，是一个本地化知识管理工具，通过 LLM 将 EPUB/PDF 文档转化为结构化概念图谱。

**技术栈**:
- 后端: Rust + Axum 0.8 + SQLite + sqlx
- 前端: React 18 + TypeScript + Vite 6 + Tailwind CSS
- LLM: LM Studio (OpenAI 兼容 API)

---

## 二、问题列表

### 严重程度分级

- **[BLOCKING]**: 阻塞性问题 - 必须修复才能正常运行
- **[HIGH]**: 严重问题 - 影响核心功能
- **[MEDIUM]**: 一般问题 - 不影响启动但需要修复
- **[SUGGESTION]**: 建议改进

---

### 2.1 [BLOCKING] 缺少统一启动脚本

**问题描述**: 项目没有提供一键启动脚本，用户需要手动在两个终端中分别启动后端和前端。

**位置**: 项目根目录

**严重程度**: BLOCKING

**影响**: 新用户无法快速启动项目，需要阅读 README 并在两个终端中执行命令。

**建议修复方案**:
创建项目根目录的启动脚本 `start.sh`:

```bash
#!/bin/bash
set -e

echo "Starting Intelligent Reading Concept Graph..."

# Start backend
echo "Starting backend (Rust + Axum)..."
cd backend
cargo run &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend..."
sleep 3

# Start frontend
echo "Starting frontend (React + Vite)..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "========================================"
echo "Services started:"
echo "  Backend:  http://localhost:8080"
echo "  Frontend: http://localhost:3000"
echo "========================================"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
```

或者创建 `docker-compose.yml` (如果适用)。

---

### 2.2 [HIGH] API 客户端 URL 配置与代理不匹配

**问题描述**: 前端 Vite 配置了代理将 `/api` 请求转发到 `http://localhost:8080`，但 `api-client.ts` 中的 `API_BASE_URL` 直接设置为 `http://localhost:8080`，绕过了代理。

**位置**:
- `/Users/heshi/fcy-learning/reader-v3/frontend/src/lib/api-client.ts` (第1行)
- `/Users/heshi/fcy-learning/reader-v3/frontend/vite.config.ts` (第14-18行)

**严重程度**: HIGH

**当前代码**:
```typescript
// api-client.ts
const API_BASE_URL = 'http://localhost:8080'  // 绕过了 Vite 代理
```

```typescript
// vite.config.ts
server: {
  port: 3000,
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },
}
```

**影响**:
- 开发模式下前端直接连接后端 8080 端口，可能遇到 CORS 问题
- 代理配置未被使用
- 生产环境部署时需要修改 API_BASE_URL

**建议修复方案**:

方案1 - 修改 api-client.ts 使用相对路径:
```typescript
const API_BASE_URL = ''  // 使用相对路径，通过代理
```

方案2 - 根据环境切换:
```typescript
const API_BASE_URL = import.meta.env.DEV ? '' : 'http://localhost:8080'
```

---

### 2.3 [MEDIUM] 数据目录结构不一致

**问题描述**: 后端在不同位置创建数据文件，存在路径混淆。

**位置**:
- `/Users/heshi/fcy-learning/reader-v3/backend/src/main.rs` (第189行)
- `/Users/heshi/fcy-learning/reader-v3/backend/data/reader.db` (存在)
- `/Users/heshi/fcy-learning/reader-v3/data/` (空目录)

**当前行为**:
```rust
// main.rs 第665-670行
let current_dir = std::env::current_dir()?;  // 获取当前工作目录
let data_dir = current_dir.join("data");     // 相对于工作目录
```

**影响**:
- 后端运行时数据目录是 `{project_root}/backend/data/`
- 如果从项目根目录运行，数据会在 `./data/`
- 如果从 `backend/` 目录运行，数据会在 `./data/`
- 可能导致数据库和书籍文件位置不一致

**建议修复方案**:
使用固定的绝对路径:
```rust
let data_dir = PathBuf::from("/Users/heshi/fcy-learning/reader-v3/data");
```

或者使用环境变量:
```rust
let data_dir = std::env::var("DATA_DIR")
    .map(PathBuf::from)
    .unwrap_or_else(|_| current_dir.join("data"));
```

---

### 2.4 [MEDIUM] multipart/form-data 解析错误 - 无法复现

**问题描述**: 用户报告上传文件 API 报错 "Error parsing multipart/form-data request"。

**位置**: `/Users/heshi/fcy-learning/reader-v3/backend/src/main.rs` (第146-219行)

**分析**:
1. 我进行了 curl 测试，上传 API 正常工作
2. 后端使用 Axum 0.8 的 `multipart` feature，代码实现正确
3. 前端使用 XMLHttpRequest 正确发送 FormData

**可能原因**:
1. 网络代理或防火墙干扰
2. 文件过大超出限制
3. 文件名编码问题（中文名）
4. 前端请求被错误拦截

**建议修复方案**:
1. 检查 `Cargo.toml` 中 tokio 的 `features = ["full"]` 是否足够
2. 在 `upload_book` 函数中添加更详细的错误日志:
```rust
while let Some(field) = multipart.next_field().await.map_err(|e| {
    tracing::error!("Multipart parsing error: {:?}", e);
    e.to_string()
})? {
```

3. 前端增加错误处理，显示更详细的错误信息

---

### 2.5 [MEDIUM] 前端 PDF 加载使用绝对 URL

**问题描述**: PDFReader 组件使用硬编码的绝对 URL 加载 PDF。

**位置**: `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/PDFReader.tsx` (第40行)

**当前代码**:
```typescript
const fullUrl = `http://localhost:8080${filePath}`
```

**影响**: 如果后端部署在不同端口或域名，PDF 将无法加载。

**建议修复方案**:
```typescript
const fullUrl = `${window.location.origin}${filePath}`
```

或者通过 API 获取文件:
```typescript
const fullUrl = `/api/books/${bookId}/file`  // 新增后端接口
```

---

### 2.6 [MEDIUM] EPUB 加载同样使用硬编码 URL

**问题描述**: EPUBReader 组件同样使用硬编码的绝对 URL。

**位置**: `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/EPUBReader.tsx` (第46行)

**当前代码**:
```typescript
const fullUrl = `http://localhost:8080${filePath}`
```

**影响**: 同 PDF 加载问题。

**建议修复方案**: 同 PDF 加载问题。

---

### 2.7 [MEDIUM] 数据库路径使用相对路径

**问题描述**: 数据库连接使用相对路径，可能导致路径问题。

**位置**: `/Users/heshi/fcy-learning/reader-v3/backend/src/main.rs` (第671行)

**当前代码**:
```rust
let database_url = format!("sqlite:///{}", db_path.display());
```

**影响**: 依赖工作目录，可能在不同运行环境下行为不一致。

**建议修复方案**:
```rust
let db_path = data_dir.join("reader.db");
let database_url = format!("sqlite:///{}", db_path.display());
```

已确认 `data_dir` 在前面正确设置为 `current_dir.join("data")`，但建议使用绝对路径确保一致性。

---

### 2.8 [SUGGESTION] 缺少后端 API 文件服务

**问题描述**: 前端需要加载 PDF/EPUB 文件，但后端没有专门的静态文件服务路由。

**位置**: `/Users/heshi/fcy-learning/reader-v3/backend/src/main.rs`

**当前状态**: 前端直接通过 `http://localhost:8080/data/books/xxx.pdf` 访问文件，这依赖:
1. 工作目录是 `backend/`
2. CORS 允许跨域访问静态文件

**建议修复方案**:
添加显式的静态文件服务:
```rust
use tower_http::fs::ServeDir;

Router::new()
    .route("/api/health", get(health))
    // ... 其他路由
    .nest("/data", ServeDir::new("data"))
```

---

### 2.9 [SUGGESTION] 前端 API 错误处理不完善

**问题描述**: 前端 API 客户端的错误处理可能不够详细。

**位置**: `/Users/heshi/fcy-learning/reader-v3/frontend/src/lib/api-client.ts`

**当前代码**:
```typescript
xhr.addEventListener('error', () => {
  reject(new Error('Network error during upload'))
})
```

**建议改进**: 提供更详细的错误信息，包括服务器返回的错误体。

---

### 2.10 [SUGGESTION] 缺少环境变量配置

**问题描述**: 后端配置（如数据库路径、LLM URL）硬编码在代码中。

**位置**:
- `/Users/heshi/fcy-learning/reader-v3/backend/src/main.rs` (第701行: 硬编码端口 8080)
- `/Users/heshi/fcy-learning/reader-v3/backend/src/extractor.rs` (第356行: 硬编码 LLM URL)

**建议改进**: 使用环境变量或 `.env` 文件:
```rust
let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
let llm_url = std::env::var("LM_STUDIO_URL").unwrap_or_else(|_| "http://localhost:1234/v1".to_string());
```

---

### 2.11 [SUGGESTION] 缺少 CORS 预检请求优化

**问题描述**: CORS 配置允许所有来源，但没有限制具体方法。

**位置**: `/Users/heshi/fcy-learning/reader-v3/backend/src/main.rs` (第678-681行)

**当前代码**:
```rust
let cors = CorsLayer::new()
    .allow_origin(Any)
    .allow_methods(Any)
    .allow_headers(Any);
```

**建议改进**: 生产环境应限制具体来源:
```rust
let cors = CorsLayer::new()
    .allow_origin("http://localhost:3000".parse::<HeaderValue>().unwrap())
    .allow_methods(["GET", "POST", "PUT", "DELETE"].into_iter().map(Method::from_bytes).collect::<Result<_, _>>().unwrap())
    .allow_headers(Any);
```

---

### 2.12 [SUGGESTION] 前端 BookList 组件缺少解析按钮

**问题描述**: BookList 组件有 Extract 按钮，但没有 Parse 按钮。解析是概念提取的前置步骤。

**位置**: `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/BookList.tsx`

**分析**: 用户上传书籍后需要先 Parse 再 Extract，但当前 UI 只显示 Extract 按钮。

**建议改进**: 添加 Parse 按钮或显示书籍解析状态。

---

## 三、编译和运行测试结果

### 后端编译
```
cargo check - 通过
cargo build - 通过
```

### 前端编译
```
npm run typecheck - 通过
npm run build - 通过 (生成 dist/ 目录)
```

### 后端运行测试
```
cargo run - 成功启动
GET /api/health - 返回 {"status":"ok"}
POST /api/books/upload - 测试通过，返回 book_id
```

### 前端运行测试
```
npm run dev - 成功启动在 port 3000
```

---

## 四、修复优先级建议

### 第一优先级 (必须修复)
1. **[BLOCKING]** 创建启动脚本 `start.sh`
2. **[HIGH]** 修复 API_BASE_URL 配置

### 第二优先级 (重要)
3. **[MEDIUM]** 统一数据目录结构
4. **[MEDIUM]** 添加详细的 multipart 错误日志
5. **[MEDIUM]** 修复 PDF/EPUB 加载 URL 问题

### 第三优先级 (建议)
6. **[SUGGESTION]** 添加静态文件服务
7. **[SUGGESTION]** 改进错误处理
8. **[SUGGESTION]** 添加环境变量配置
9. **[SUGGESTION]** 添加 Parse 按钮

---

## 五、结论

项目整体结构良好，代码质量较高，核心功能（上传、解析、概念提取、图谱可视化）均已实现。后端使用 Rust + Axum 的技术栈表现出色，前端使用 React + TypeScript + Tailwind CSS 的组合也是现代 Web 开发的最佳实践。

主要问题集中在:
1. **用户体验**: 缺少一键启动脚本对新用户不友好
2. **配置一致性**: 前后端 URL 配置存在不一致
3. **路径管理**: 数据目录路径依赖工作目录

建议按照第四节的优先级顺序进行修复。
