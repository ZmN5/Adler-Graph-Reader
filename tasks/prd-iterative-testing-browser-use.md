# PRD: 智能阅读产品迭代测试与修复

## 1. 概述

使用 browser-use 自动化框架对产品进行全面的迭代式走查。流程为：上传书籍（sample_books 目录下）→ 整理问题报告 → 修复问题 → 继续验证。迭代至少 10 轮，直到连续 3 轮走查未发现新问题为止。

## 2. 目标

- 使用 browser-use 自动化框架完成端到端功能走查
- 覆盖完整产品流程：上传 → 阅读 → 概念图谱 → 提取 → 全部功能
- 规范化问题报告格式（结构化报告）
- 迭代修复发现的问题
- 达到连续 3 轮走查无新问题后停止迭代

## 3. 用户故事

### US-001: 上传书籍流程走查
**描述:** 使用 browser-use 上传 sample_books 下的 PDF/EPUB 书籍，验证上传功能正常。

**验收标准:**
- [ ] browser-use 能成功打开上传页面
- [ ] 能依次上传 4 本书籍（designing-machine-learning-systems.pdf, delta-lake-the-definitive-guide-modern-data-lakehouse.pdf, domain-specific-slm.epub, you-dont-know-js-yet.epub）
- [ ] 上传进度显示正常
- [ ] 上传完成后书籍出现在书库列表中
- [ ] 每本书籍能正确加载内容

### US-002: 阅读功能走查
**描述:** 验证已上传书籍的阅读功能，包括翻页、目录跳转、字体设置等。

**验收标准:**
- [ ] 能打开书籍阅读界面
- [ ] 翻页功能正常（前翻/后翻）
- [ ] 目录/大纲功能正常
- [ ] 阅读进度保存正常

### US-003: 概念图谱功能走查
**描述:** 验证概念图谱的生成和展示功能。

**验收标准:**
- [ ] 能触发概念图谱生成
- [ ] 图谱展示正常（节点、连线可见）
- [ ] 图谱交互功能正常（缩放、拖拽）
- [ ] Core Concepts 弹窗功能正常

### US-004: 提取功能走查
**描述:** 验证从书籍中提取内容的功能。

**验收标准:**
- [ ] 提取按钮功能正常
- [ ] 提取进度显示正常
- [ ] 提取结果正确显示
- [ ] Previous/Next 按钮功能正常

### US-005: 问题报告生成
**描述:** 将发现的问题以结构化格式记录。

**验收标准:**
- [ ] 每轮走查后生成结构化问题报告
- [ ] 报告包含：问题类型、严重程度、复现步骤、截图
- [ ] 问题按严重程度分类（P0/P1/P2/P3）

### US-006: 问题修复与验证
**描述:** 修复发现的问题并用 browser-use 重新验证。

**验收标准:**
- [ ] 修复后能通过 browser-use 自动化测试
- [ ] 回归测试确认修复未引入新问题
- [ ] 修复记录归档

## 4. 功能需求

### FR-1: 测试环境准备
- FR-1.1: 安装配置 browser-use 框架
- FR-1.2: 确认服务（前端 3000 端口，后端 8080 端口）正常运行
- FR-1.3: 确认 sample_books 目录下有可用的 PDF/EPUB 文件

### FR-2: 走查执行
- FR-2.1: 使用 browser-use 自动化打开浏览器并访问产品
- FR-2.2: 按顺序执行上传、阅读、概念图谱、提取等功能操作
- FR-2.3: 每轮走查记录发现的所有问题

### FR-3: 问题报告
- FR-3.1: 问题报告格式
  ```json
  {
    "round": 1,
    "issue_id": "BUG-001",
    "title": "问题简述",
    "type": "功能缺陷 | UI 问题 | 性能问题 | 其他",
    "severity": "P0 | P1 | P2 | P3",
    "description": "详细描述",
    "reproduction_steps": ["步骤1", "步骤2"],
    "expected": "预期行为",
    "actual": "实际行为",
    "screenshot": "screenshots/round1-bug001.png",
    "status": "open | fixed | wontfix"
  }
  ```
- FR-3.2: 严重程度定义
  - P0: 核心功能完全不可用
  - P1: 核心功能严重受损
  - P2: 功能有缺陷但有 workaround
  - P3: UI/体验问题

### FR-4: 迭代流程
- FR-4.1: 每轮走查后整理问题报告
- FR-4.2: 按严重程度排序修复问题
- FR-4.3: 修复后使用 browser-use 重新验证
- FR-4.4: 记录每轮走查的结论（是否发现新问题）

### FR-5: 迭代终止条件
- FR-5.1: 连续 3 轮走查未发现新问题
- FR-5.2: 或者完成 10 轮迭代
- FR-5.3: 满足任一条件即终止迭代

## 5. 非目标

- 不进行性能压力测试
- 不测试非 PDF/EPUB 格式的文件
- 不测试用户认证/权限相关功能（如果存在）
- 不进行代码重构（除非是修复问题的必要手段）

## 6. 技术考虑

### 测试书籍清单
| 文件名 | 格式 | 说明 |
|--------|------|------|
| designing-machine-learning-systems.pdf | PDF | ML 系统设计书籍 |
| delta-lake-the-definitive-guide-modern-data-lakehouse.pdf | PDF | Delta Lake 指南 |
| domain-specific-slm.epub | EPUB | 领域特定 SLM |
| you-dont-know-js-yet.epub | EPUB | JavaScript 深入 |

### browser-use 配置
- 使用 Chrome/Chromium 浏览器
- 截图保存到 `tasks/screenshots/round{N}/` 目录
- 操作日志保存到 `tasks/logs/round{N}.log`

### 问题跟踪
- 问题报告保存到 `tasks/reports/round{N}-report.md`
- 汇总报告保存到 `tasks/reports/summary.md`

## 7. 成功指标

- 达到连续 3 轮走查无新问题
- 所有 P0/P1 问题已修复或确认不会修复
- 生成完整的问题跟踪记录

## 8. 开放问题

- 每轮走查之间是否需要等待服务稳定？
- 是否需要测试并发上传多本书籍？
