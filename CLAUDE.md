# CLAUDE.md

## 项目概述

- **项目路径**: `/Users/heshi/fcy-learning/reader-v3`
- **项目类型**: 待定义（根据实际项目补充）

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

**所有后端开发任务必须使用 `backend-architect` 子 agent**

- 遵循良好的架构设计原则
- 提供清晰的 API 契约
- 开发完成后必须提交评估

### 4. 评估流程

**每一版开发结束必须使用 `project-evaluator` 子 agent 进行评估**

- 评估维度：功能完整性、代码质量、设计一致性、性能表现
- 评估通过方可进入下一阶段
- 评估报告需存档记录

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

## 记忆系统

项目相关的上下文信息存储在 `MEMORY.md` 中索引的独立文件中。
