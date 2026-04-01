# CLAUDE.md

## 项目概述

- **项目路径**: `/Users/heshi/fcy-learning/reader-v3`
- **项目类型**: 智能阅读概念图谱系统 (Intelligent Reading Concept Graph)
- **技术栈**:
  - 后端: Rust + Axum 0.8 + SQLite + sqlx
  - 前端: React 18 + TypeScript + Vite 6 + Tailwind CSS
  - LLM: LM Studio (OpenAI 兼容 API)
- **启动端口**: 后端 8080，前端 3000
- **启动脚本**: `./start.sh`

---

## 工作流程规范

### 1. UI 设计流程

**所有 UI 设计任务必须使用 `ui-design-perfectionist` 子 agent**

- 发起 UI 设计任务时，提供完整的产品需求和设计规范
- 设计方案需经过设计评审，确保独特性和一致性
- 避免使用通用模板，追求原创设计语言

### 2. 前端开发流程

**所有前端开发任务必须使用 `frontend-senior-developer` 子 agent**

- 严格遵循 UI 设计规范，确保设计还原度
- 与 UI 设计 agent 保持沟通，确保实现符合设计意图
- 开发完成后必须提交评估

### 3. 后端开发流程

**所有前端开发任务必须使用 `backend-architect` 子 agent**

- 遵循良好的架构设计原则
- 提供清晰的 API 契约
- 开发完成后必须提交评估

### 4. 评估流程

**每一版开发结束必须使用 `project-evaluator` 子 agent 进行评估**

- 评估维度：功能完整性、代码质量、设计一致性、性能表现
- 评估通过方可进入下一阶段
- 评估报告需存档记录到 `tasks/` 目录

---

## 并行执行策略

**能并行则并行，遵循以下原则：**

1. **UI 设计 + 架构设计**：产品需求确认后，UI 设计和后端架构可并行进行
2. **前端 + 后端**：接口契约确定后，前后端开发可并行进行
3. **评估串行**：每阶段开发完成后，评估必须串行执行（不可与开发并行）

---

## 任务发起规范

### UI 设计任务
```
使用 Agent tool，subagent_type: ui-design-perfectionist
```

### 前端开发任务
```
使用 Agent tool，subagent_type: frontend-senior-developer
```

### 后端开发任务
```
使用 Agent tool，subagent_type: backend-architect
```

### 评估任务
```
使用 Agent tool，subagent_type: project-evaluator
```

---

## 禁止事项

- 禁止在 UI 未确认前开始前端开发
- 禁止跳过评估直接进入下一阶段
- 禁止手动编写重复性代码（使用 agent 自动化）

---

## 项目规范

### 数据目录

**⚠️ 重要：数据库实际路径是 `backend/data/reader.db`，不是项目根目录的 `data/reader.db`**

由于后端服务从 `backend/` 目录启动，数据目录结构如下：

| 类型 | 路径 | 说明 |
|------|------|------|
| 数据库 | `backend/data/reader.db` | ✅ SQLite 数据库文件 |
| 书籍文件 | `backend/data/books/` | PDF/EPUB 文件存储 |
| 数据库备份 | `backend/data/backups/` | 自动备份存储 |

**常见错误**：
- ❌ 根目录 `data/reader.db` 是空的（如果存在可以删除）
- ✅ 实际使用的是 `backend/data/reader.db`

### 运维脚本

项目提供以下运维脚本（位于 `scripts/` 目录）：

| 脚本 | 用途 | 示例 |
|------|------|------|
| `db.sh` | 数据库管理 | `./scripts/db.sh reset` 重置数据库 |
| `service.sh` | 服务管理 | `./scripts/service.sh restart` 重启服务 |
| `service.sh` | 模型检查 | `./scripts/service.sh check-models` 检查LM Studio模型 |
| `service.sh` | 模型加载 | `./scripts/service.sh start-models` 加载所需模型 |

**常用命令**：
```bash
# 查看数据库路径信息
./scripts/db.sh path

# 查看数据库表结构和记录数
./scripts/db.sh tables

# 重置数据库（数据会丢失，自动备份）
./scripts/db.sh reset

# 查看服务状态
./scripts/service.sh status

# 重启所有服务
./scripts/service.sh restart

# 查看后端日志
./scripts/service.sh logs backend

# 检查LM Studio模型是否已下载
./scripts/service.sh check-models

# 加载所需的LM Studio模型
./scripts/service.sh start-models
```

**LM Studio CLI 安装**：
如果 `check-models` 或 `start-models` 提示 `lms CLI 未找到`，请安装 LM Studio CLI：
1. 打开 LM Studio 应用
2. 点击左下角设置 (Settings)
3. 选择 'CLI' 标签页
4. 点击 'Install CLI' 按钮

**手动模型管理命令**：
```bash
# 检查模型是否已下载
lms models list | grep Qwen3-Embedding

# 下载模型
lms models pull mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ

# 加载模型
lms models load mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ

# 查看已加载的模型
lms models loaded

# 启动LM Studio服务器
lms server start
```

### API 配置
- 前端 API 请求使用相对路径（空字符串），通过 Vite 代理转发
- 生产环境通过 `VITE_API_BASE_URL` 环境变量配置
- PDF/EPUB 文件加载使用 `window.location.origin` 动态获取当前域

### CORS 配置
- 开发环境允许所有来源
- 生产环境应限制具体来源

---

## 记忆系统

项目相关的上下文信息存储在 `MEMORY.md` 中索引的独立文件中。
