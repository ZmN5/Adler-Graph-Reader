# Apple 风格 UI 重构设计方案

## 设计概述

将当前的太空/科幻主题（深色背景、霓虹发光效果、Orbitron 字体、星空动画）全面重构为 Apple 风格——简洁、清晰、干净、以浅色为主。核心目标：
1. **阅读器内容可见性**：PDF/EPUB 阅读器必须有明确的白色/浅色背景容器，确保文字清晰可读
2. **视觉降噪**：移除所有发光效果、渐变背景、星空动画
3. **系统级美学**：使用 Apple Design System 的灰度体系、SF Pro 字体栈、微妙阴影

---

## 1. 颜色系统

### 1.1 CSS 变量（HSL 格式）

```css
:root {
  /* === Apple Light Theme === */

  /* 背景层级 */
  --background: 0 0% 100%;           /* #FFFFFF - 页面主背景 */
  --background-secondary: 210 20% 98%; /* #F8FAFC - 次级背景 */
  --background-tertiary: 220 14% 96%;  /* #F1F5F9 - 三级背景 */

  /* 前景/文字 */
  --foreground: 220 14% 10%;         /* #0F172A - 主文字 */
  --foreground-secondary: 215 16% 47%; /* #64748B - 次级文字 */
  --foreground-tertiary: 215 14% 63%;  /* #94A3B8 - 辅助文字 */

  /* 卡片/面板 */
  --card: 0 0% 100%;                 /* #FFFFFF */
  --card-foreground: 220 14% 10%;

  --popover: 0 0% 100%;
  --popover-foreground: 220 14% 10%;

  /* 主色 - Apple System Blue */
  --primary: 211 100% 50%;           /* #007AFF */
  --primary-foreground: 0 0% 100%;   /* #FFFFFF */

  /* 次色 */
  --secondary: 210 20% 96%;          /* #F1F5F9 */
  --secondary-foreground: 220 14% 10%;

  /* 弱化/禁用 */
  --muted: 210 20% 96%;
  --muted-foreground: 215 16% 47%;

  /* 强调色 */
  --accent: 211 100% 50%;
  --accent-foreground: 0 0% 100%;

  /* 危险/删除 */
  --destructive: 0 84% 60%;          /* #EF4444 */
  --destructive-foreground: 0 0% 100%;

  /* 边框 */
  --border: 214 32% 91%;             /* #E2E8F0 */
  --input: 214 32% 91%;
  --ring: 211 100% 50%;

  /* 圆角 */
  --radius: 0.75rem;
}
```

### 1.2 语义化颜色使用规范

| 用途 | 变量 | 实际色值 | 使用场景 |
|------|------|----------|----------|
| 页面背景 | `--background` | #FFFFFF | 整个页面底色 |
| 卡片背景 | `--card` | #FFFFFF | 书籍卡片、面板 |
| 次级背景 | `--background-secondary` | #F8FAFC | Header、Tab栏 |
| 阅读器背景 | `#FFFFFF` | 纯白 | PDF/EPUB 渲染区域 |
| 主文字 | `--foreground` | #0F172A | 标题、正文 |
| 次级文字 | `--foreground-secondary` | #64748B | 描述、元信息 |
| 辅助文字 | `--foreground-tertiary` | #94A3B8 | 占位符、禁用态 |
| 主按钮 | `--primary` | #007AFF | 主要操作按钮 |
| 边框 | `--border` | #E2E8F0 | 卡片边框、分割线 |
| 悬停背景 | `hsl(210, 20%, 96%)` | #F1F5F9 | 列表项悬停 |

### 1.3 图谱专用颜色（浅色背景适配）

原太空主题的霓虹色在白色背景上过于刺眼，调整为更柔和的色调：

```typescript
// 替换 graph-utils.ts 中的颜色定义
export const PLANET_COLORS: Record<string, { base: string; glow: string; atmosphere: string }> = {
  Philosophy:  { base: '#5856D6', glow: '#7A78E0', atmosphere: 'rgba(88, 86, 214, 0.25)' },
  Science:     { base: '#34C759', glow: '#5DD47A', atmosphere: 'rgba(52, 199, 89, 0.25)' },
  History:     { base: '#FF9500', glow: '#FFAA33', atmosphere: 'rgba(255, 149, 0, 0.25)' },
  Art:         { base: '#FF2D55', glow: '#FF5C7F', atmosphere: 'rgba(255, 45, 85, 0.25)' },
  Technology:  { base: '#5AC8FA', glow: '#7DD4FB', atmosphere: 'rgba(90, 200, 250, 0.25)' },
  Politics:    { base: '#FF3B30', glow: '#FF6B63', atmosphere: 'rgba(255, 59, 48, 0.25)' },
  Economics:   { base: '#A2845E', glow: '#B59D7E', atmosphere: 'rgba(162, 132, 94, 0.25)' },
  Psychology:  { base: '#AF52DE', glow: '#C27DE6', atmosphere: 'rgba(175, 82, 222, 0.25)' },
  Other:       { base: '#8E8E93', glow: '#A5A5AA', atmosphere: 'rgba(142, 142, 147, 0.25)' },
}

export const CORE_COLOR = {
  base: '#007AFF',
  glow: '#3395FF',
  atmosphere: 'rgba(0, 122, 255, 0.3)'
}

export const DEFAULT_PLANET_COLOR = {
  base: '#8E8E93',
  glow: '#A5A5AA',
  atmosphere: 'rgba(142, 142, 147, 0.2)'
}
```

---

## 2. 字体系统

### 2.1 字体栈

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display',
    'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
```

**移除**：`Orbitron`、`Space Grotesk` 及 Google Fonts 引入。

### 2.2 字号层级

| 层级 | 大小 | 字重 | 行高 | 字间距 | 用途 |
|------|------|------|------|--------|------|
| Display | 32px / 2rem | 700 | 1.1 | -0.02em | Hero 标题 |
| H1 | 24px / 1.5rem | 600 | 1.2 | -0.01em | 页面标题 |
| H2 | 20px / 1.25rem | 600 | 1.3 | -0.01em | 区块标题 |
| H3 | 17px / 1.0625rem | 600 | 1.35 | 0 | 卡片标题 |
| Body | 14px / 0.875rem | 400 | 1.5 | 0 | 正文 |
| Small | 13px / 0.8125rem | 400 | 1.4 | 0 | 描述、元信息 |
| Caption | 12px / 0.75rem | 500 | 1.3 | 0.01em | 标签、徽章 |

---

## 3. 阴影系统

Apple 风格的阴影是"大面积、低对比度、柔和"：

```css
/* 卡片阴影 */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03);
--shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.07), 0 4px 8px rgba(0, 0, 0, 0.04);
--shadow-xl: 0 24px 48px rgba(0, 0, 0, 0.08), 0 8px 16px rgba(0, 0, 0, 0.04);

/* 悬浮态增强 */
--shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
```

---

## 4. 间距系统

Apple 设计偏爱"呼吸感"——更宽松的间距：

| Token | 值 | 用途 |
|-------|-----|------|
| space-1 | 4px | 图标与文字间距 |
| space-2 | 8px | 紧凑内联间距 |
| space-3 | 12px | 按钮内边距 |
| space-4 | 16px | 卡片内边距 |
| space-5 | 20px | 区块间距 |
| space-6 | 24px | 卡片组间距 |
| space-8 | 32px | 大区块间距 |
| space-10 | 40px | 页面级间距 |
| space-12 | 48px | Hero 区域 |

---

## 5. 组件设计规范

### 5.1 Header

```
背景: #FFFFFF
高度: 48px (比原来 56px 更紧凑)
底部边框: 1px solid #E2E8F0
阴影: 0 1px 2px rgba(0,0,0,0.04)

Logo 文字:
  - 字体: system-ui, 600 weight
  - 颜色: #0F172A
  - 大小: 17px
  - 移除 glow-text、渐变文字效果

右侧按钮:
  - 背景: transparent
  - 文字: #64748B
  - 悬停: background #F1F5F9, color #0F172A
  - 圆角: 8px
  - 无边框（或 1px #E2E8F0）
```

### 5.2 书籍列表项 (BookList)

```
背景: #FFFFFF
边框: 1px solid #E2E8F0
圆角: 12px
内边距: 16px
阴影: 0 1px 2px rgba(0,0,0,0.04)

悬停状态:
  - 边框: 1px solid #CBD5E1
  - 阴影: 0 4px 12px rgba(0,0,0,0.05)
  - 背景: #F8FAFC
  - 无发光效果

格式徽章:
  - PDF: bg #FEE2E2, text #DC2626, border #FECACA
  - EPUB: bg #DBEAFE, text #2563EB, border #BFDBFE

操作按钮:
  - Parse: bg #EFF6FF, text #2563EB, border #BFDBFE
  - Extract: bg #F0FDF4, text #16A34A, border #BBF7D0
  - Delete: bg #FEF2F2, text #DC2626, border #FECACA
  - 悬停时加深 5%
```

### 5.3 上传区域 (UploadButton)

```
背景: #FFFFFF
边框: 2px dashed #CBD5E1
圆角: 16px
内边距: 40px

拖拽悬停:
  - 边框: 2px dashed #007AFF
  - 背景: rgba(0, 122, 255, 0.04)

图标: #94A3B8 (拖拽时 #007AFF)
主文字: #64748B, 14px
副文字: #94A3B8, 13px

配置面板:
  - 背景: #FFFFFF
  - 边框: 1px solid #E2E8F0
  - 圆角: 12px
  - 阴影: 0 4px 12px rgba(0,0,0,0.05)
```

### 5.4 阅读器区域（关键修复）

**这是本次重构最核心的部分——确保书籍内容可见。**

#### PDF 阅读器

```
阅读器容器:
  - 背景: #FFFFFF (纯白，不再是透明/深色)
  - 边框: 1px solid #E2E8F0
  - 圆角: 12px (内部内容区)

页面指示器栏:
  - 背景: #F8FAFC
  - 边框底部: 1px solid #E2E8F0
  - 文字: #64748B, 13px

PDF 页面渲染:
  - 每个页面容器: 背景 #FFFFFF
  - 阴影: 0 4px 12px rgba(0,0,0,0.08) — 模拟真实纸张
  - 页面间距: 16px

滚动条:
  - 轨道: #F1F5F9
  - 滑块: #CBD5E1
  - 滑块悬停: #94A3B8
```

#### EPUB 阅读器

```
阅读器容器:
  - 背景: #FFFFFF
  - 边框: 1px solid #E2E8F0

章节指示器栏:
  - 背景: #F8FAFC
  - 边框底部: 1px solid #E2E8F0

EPUB 内容区:
  - 背景: #FFFFFF
  - 确保 epubjs 渲染的 iframe 内部也是白色背景
  - 注入 CSS: body { background: #FFFFFF !important; color: #1E293B !important; }
```

### 5.5 三栏布局 (ThreeColumnLayout)

```
整体背景: #F8FAFC (浅灰，区分各面板)

左栏（阅读器）:
  - 背景: #FFFFFF
  - 边框右: 1px solid #E2E8F0
  - 折叠按钮: bg #F1F5F9, hover #E2E8F0

中栏（图谱）:
  - 背景: #F8FAFC (或 #FFFFFF)
  - Tab 栏: bg #FFFFFF, border-bottom #E2E8F0

右栏（详情面板）:
  - 背景: #FFFFFF
  - 边框左: 1px solid #E2E8F0
  - 宽度: 320px (略增)

拖拽分割线:
  - 默认: transparent
  - 悬停: 2px wide #007AFF
  - 拖拽中: 2px wide #007AFF
```

### 5.6 概念图谱 (GraphCanvas)

```
画布背景: #F8FAFC (或透明，让底层背景透出)

节点:
  - 核心节点: #007AFF 填充，白色描边 2px
  - 普通节点: 按类别色填充，白色描边 1.5px
  - 悬停: 放大 1.15x，阴影增强
  - 选中: 外圈 2px #007AFF

连线:
  - 默认: #CBD5E1, 1px
  - 高亮: #007AFF, 1.5px
  - 动画粒子: #007AFF 半透明

标签:
  - 背景: rgba(255,255,255,0.9)
  - 文字: #0F172A
  - 圆角: 6px
  - 内边距: 4px 8px
  - 阴影: 0 1px 2px rgba(0,0,0,0.06)

悬浮提示 (Tooltip):
  - 背景: #FFFFFF
  - 边框: 1px solid #E2E8F0
  - 阴影: 0 8px 24px rgba(0,0,0,0.08)
  - 圆角: 10px
  - 文字: #0F172A

控制面板（搜索、图例、筛选）:
  - 背景: rgba(255,255,255,0.85)
  - backdrop-filter: blur(12px)
  - 边框: 1px solid #E2E8F0
  - 圆角: 12px
  - 阴影: 0 4px 12px rgba(0,0,0,0.05)
```

### 5.7 节点详情面板 (NodeDetailPanel)

```
面板背景: #FFFFFF
头部:
  - 背景: #F8FAFC
  - 边框底部: 1px solid #E2E8F0
  - 标题: 17px, 600 weight, #0F172A

内容区块:
  - 边框: 1px solid #E2E8F0
  - 圆角: 10px
  - 背景: #FFFFFF
  - 内边距: 16px

AI 分析区块:
  - 头部: bg #F8FAFC, 图标 #007AFF
  - 引用按钮: bg #EFF6FF, text #007AFF, 圆角 6px

来源引用:
  - 背景: #F8FAFC
  - 悬停: #F1F5F9
  - 索引标签: bg #EFF6FF, text #007AFF

相关概念:
  - 按钮: bg #F1F5F9, hover #E2E8F0
  - 关系文字: #64748B
  - 节点名: #007AFF
```

### 5.8 核心概念列表 (CoreConceptsList)

```
头部:
  - 图标: #007AFF
  - 标题: 20px, 600 weight
  - 计数徽章: bg #EFF6FF, text #007AFF

概念卡片:
  - 背景: #FFFFFF
  - 边框: 1px solid #E2E8F0
  - 圆角: 12px
  - 内边距: 20px
  - 悬停: border #CBD5E1, shadow-md, bg #F8FAFC

核心星标:
  - 填充: #007AFF
  - 无发光/脉冲动画（或极 subtle 的缩放动画）

"View" 按钮:
  - bg #EFF6FF, text #007AFF
  - hover: bg #DBEAFE
```

### 5.9 设置面板 (ModelSettings)

```
头部:
  - 背景: #FFFFFF
  - 边框底部: 1px solid #E2E8F0

设置项卡片:
  - 背景: #FFFFFF
  - 边框: 1px solid #E2E8F0
  - 圆角: 10px
  - 内边距: 16px

输入框:
  - 背景: #FFFFFF
  - 边框: 1px solid #CBD5E1
  - 圆角: 8px
  - 聚焦: border #007AFF, ring 3px rgba(0,122,255,0.15)

保存按钮:
  - bg #007AFF, text white
  - hover: bg #0056D3
  - 圆角: 8px
```

---

## 6. 全局样式（完整 index.css 替换方案）

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* === Apple Light Theme === */
    --background: 0 0% 100%;
    --foreground: 220 14% 10%;

    --card: 0 0% 100%;
    --card-foreground: 220 14% 10%;

    --popover: 0 0% 100%;
    --popover-foreground: 220 14% 10%;

    --primary: 211 100% 50%;
    --primary-foreground: 0 0% 100%;

    --secondary: 210 20% 96%;
    --secondary-foreground: 220 14% 10%;

    --muted: 210 20% 96%;
    --muted-foreground: 215 16% 47%;

    --accent: 210 20% 96%;
    --accent-foreground: 220 14% 10%;

    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;

    --border: 214 32% 91%;
    --input: 214 32% 91%;
    --ring: 211 100% 50%;

    --radius: 0.75rem;

    /* Custom Apple-style shadows */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03);
    --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.07), 0 4px 8px rgba(0, 0, 0, 0.04);
    --shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
  }
}

@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply text-foreground antialiased;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display',
      'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: hsl(var(--background));
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Scrollbar - Apple style */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: #CBD5E1;
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #94A3B8;
  }

  /* Selection color */
  ::selection {
    background: rgba(0, 122, 255, 0.2);
    color: #0F172A;
  }
}

@layer components {
  /* Card - clean Apple style */
  .apple-card {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 12px;
    box-shadow: var(--shadow-sm);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .apple-card:hover {
    border-color: #CBD5E1;
    box-shadow: var(--shadow-md);
  }

  /* Panel - for side panels and modals */
  .apple-panel {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    box-shadow: var(--shadow-md);
  }

  /* Primary button */
  .btn-primary {
    background: #007AFF;
    color: #FFFFFF;
    border-radius: 8px;
    font-weight: 500;
    font-size: 14px;
    padding: 8px 16px;
    transition: all 0.15s ease;
  }

  .btn-primary:hover {
    background: #0056D3;
    transform: translateY(-0.5px);
  }

  .btn-primary:active {
    transform: scale(0.98);
  }

  /* Secondary button */
  .btn-secondary {
    background: #F1F5F9;
    color: #0F172A;
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    font-weight: 500;
    font-size: 14px;
    padding: 8px 16px;
    transition: all 0.15s ease;
  }

  .btn-secondary:hover {
    background: #E2E8F0;
    border-color: #CBD5E1;
  }

  /* Ghost button */
  .btn-ghost {
    background: transparent;
    color: #64748B;
    border-radius: 8px;
    font-weight: 500;
    font-size: 14px;
    padding: 8px 16px;
    transition: all 0.15s ease;
  }

  .btn-ghost:hover {
    background: #F1F5F9;
    color: #0F172A;
  }

  /* Input field */
  .apple-input {
    background: #FFFFFF;
    border: 1px solid #CBD5E1;
    border-radius: 8px;
    color: #0F172A;
    font-size: 14px;
    padding: 8px 12px;
    transition: all 0.15s ease;
  }

  .apple-input::placeholder {
    color: #94A3B8;
  }

  .apple-input:focus {
    border-color: #007AFF;
    outline: none;
    box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
  }

  /* Badge */
  .apple-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 9999px;
  }

  .apple-badge-blue {
    background: #EFF6FF;
    color: #2563EB;
    border: 1px solid #BFDBFE;
  }

  .apple-badge-green {
    background: #F0FDF4;
    color: #16A34A;
    border: 1px solid #BBF7D0;
  }

  .apple-badge-red {
    background: #FEF2F2;
    color: #DC2626;
    border: 1px solid #FECACA;
  }

  /* Tab navigation */
  .apple-tab {
    position: relative;
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 500;
    color: #64748B;
    transition: all 0.15s ease;
    border-radius: 8px 8px 0 0;
  }

  .apple-tab:hover {
    color: #0F172A;
    background: #F8FAFC;
  }

  .apple-tab-active {
    color: #007AFF;
    background: #F8FAFC;
  }

  .apple-tab-active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 12px;
    right: 12px;
    height: 2px;
    background: #007AFF;
    border-radius: 1px;
  }

  /* Divider */
  .apple-divider {
    border-top: 1px solid #E2E8F0;
  }

  /* Empty state */
  .apple-empty {
    text-align: center;
    color: #94A3B8;
    padding: 48px 24px;
  }

  .apple-empty-icon {
    color: #CBD5E1;
    margin-bottom: 16px;
  }

  /* Loading spinner */
  .apple-spinner {
    border: 2px solid #E2E8F0;
    border-top-color: #007AFF;
    animation: spin 0.8s linear infinite;
  }
}

@layer utilities {
  /* Animation delays */
  .animation-delay-100 { animation-delay: 100ms; }
  .animation-delay-200 { animation-delay: 200ms; }
  .animation-delay-300 { animation-delay: 300ms; }

  /* Text truncation */
  .line-clamp-1 {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  }

  .line-clamp-2 {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .line-clamp-3 {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
}

/* Keyframe animations */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse-subtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

---

## 7. Tailwind 配置调整

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Apple system colors (for graph and accents)
        apple: {
          blue: '#007AFF',
          green: '#34C759',
          indigo: '#5856D6',
          orange: '#FF9500',
          pink: '#FF2D55',
          purple: '#AF52DE',
          red: '#FF3B30',
          teal: '#5AC8FA',
          yellow: '#FFCC00',
          gray: '#8E8E93',
        },
        // Semantic colors for status badges
        status: {
          info: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
          success: { bg: '#F0FDF4', text: '#16A34A', border: '#BBF7D0' },
          warning: { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
          error: { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' },
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'SF Pro Display',
               'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        'apple-sm': '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02)',
        'apple-md': '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03)',
        'apple-lg': '0 12px 32px rgba(0, 0, 0, 0.07), 0 4px 8px rgba(0, 0, 0, 0.04)',
        'apple-hover': '0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
        'paper': '0 4px 12px rgba(0, 0, 0, 0.08)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
}
```

---

## 8. 阅读器样式修复方案

### 8.1 PDF 阅读器修复要点

当前 PDFReader.tsx 中：
- 页面容器已有 `backgroundColor: '#f5f5f5'` — 改为 `#FFFFFF`
- 页面阴影 `boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'` — 增强为 `'0 4px 12px rgba(0, 0, 0, 0.08)'`
- 外层容器需要确保不是透明/深色背景

**关键修改**：
```tsx
// PDFReader.tsx 中页面容器样式
<div
  style={{
    position: 'absolute',
    top: pageInfo.yOffset,
    left: '50%',
    transform: 'translateX(-50%)',
    width: pageInfo.width,
    height: pageInfo.height,
    backgroundColor: '#FFFFFF',        // 改为纯白
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)', // 更柔和的纸张阴影
    borderRadius: '4px',               // 轻微圆角模拟纸张
  }}
>
```

### 8.2 EPUB 阅读器修复要点

EPUB 内容通过 epubjs 渲染在 iframe 中，需要注入 CSS 确保白色背景：

```tsx
// EPUBReader.tsx 中已有的 content hook，增强样式
rendition.hooks.content.register((contents: Contents) => {
  contents.addStylesheetCss(`
    body, html {
      overflow-y: auto !important;
      overflow-x: hidden !important;
      height: auto !important;
      background: #FFFFFF !important;
      color: #1E293B !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      line-height: 1.6 !important;
    }
    /* 确保所有子元素继承背景色 */
    body * {
      background-color: transparent !important;
    }
    /* 链接颜色 */
    a {
      color: #007AFF !important;
    }
  `, 'apple-theme-fix')
})
```

### 8.3 阅读器容器背景

确保阅读器外层容器有明确白色背景：

```tsx
// App.tsx 中阅读器包裹层
<div className="h-full bg-white border-r border-gray-200">
  {/* PDFReader or EPUBReader */}
</div>
```

---

## 9. 组件迁移对照表

| 原类名/样式 | 新类名/样式 | 所在组件 |
|-------------|-------------|----------|
| `starfield-bg` | `bg-white` 或 `bg-slate-50` | App.tsx |
| `glass-panel` | `bg-white border-b border-gray-200` | Header, panels |
| `font-orbitron` | `font-sans font-semibold` | Header, titles |
| `font-space` | `font-sans` | 所有组件 |
| `text-neon-cyan` | `text-apple-blue` | 图标、链接 |
| `border-white/10` | `border-gray-200` | 卡片、面板 |
| `bg-space-deep/60` | `bg-white` | 卡片背景 |
| `hover:border-neon-cyan/30` | `hover:border-gray-300` | 卡片悬停 |
| `glow-text` | 移除 | 标题 |
| `text-gradient-cyan` | `text-apple-blue` | Hero 副标题 |
| `shadow-[0_0_20px_rgba(0,245,255,0.1)]` | `shadow-apple-md` | 卡片阴影 |
| `backdrop-blur-sm` | 移除（或保留用于浮动面板） | 面板 |
| `bg-white/5` | `bg-slate-50` | 按钮背景 |
| `text-slate-400` | `text-gray-500` | 次要文字 |
| `text-slate-300` | `text-gray-600` | 描述文字 |
| `text-white` | `text-gray-900` | 主文字 |

---

## 10. 视觉签名（Visual Signature）

在 Apple 风格的简洁基础上，保留 2-3 个独特的设计元素，使界面具有辨识度：

1. **纸张阴影效果**：PDF 页面使用 `0 4px 12px rgba(0,0,0,0.08)` 的柔和阴影，模拟真实书籍页面的悬浮感
2. **蓝色脉冲指示器**：核心概念节点和提取中的状态使用极 subtle 的蓝色脉冲（`animate-pulse-subtle`），替代原来的强烈霓虹脉冲
3. **圆角一致性**：所有卡片、按钮、面板统一使用 12px 圆角（`rounded-xl`），输入框使用 8px（`rounded-lg`），营造友好、现代的感觉

---

## 11. 实施优先级

1. **P0 - 阅读器可见性**：PDFReader、EPUBReader 容器背景改为白色
2. **P0 - 全局样式**：替换 index.css，移除太空主题变量和动画
3. **P1 - Tailwind 配置**：更新 tailwind.config.js 颜色、字体、阴影
4. **P1 - 布局组件**：App.tsx、ThreeColumnLayout 背景调整
5. **P1 - 头部导航**：Header 组件简化
6. **P2 - 列表和卡片**：BookList、UploadButton 样式更新
7. **P2 - 图谱适配**：GraphCanvas 节点颜色、标签背景适配浅色主题
8. **P2 - 详情面板**：NodeDetailPanel、CoreConceptsList 样式更新
9. **P3 - 设置面板**：ModelSettings 样式更新
10. **P3 - 清理**：移除 StarField 组件引用、删除未使用的太空主题 CSS
