# 修复计划：LM Studio 模型未加载导致 API 500 错误

## 问题分析

**症状**:
- 前端调用 `/api/nodes/{id}/summary` 和 `/api/nodes/{id}/retrieval` 返回 500
- 后端日志显示：`"No models loaded. Please load a model in the developer page or use the 'lms load' command."`

**根因**:
- LM Studio 中没有加载 Embedding 模型
- 项目需要使用 `mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ` 模型

## 解决步骤

### 步骤 1: 检查 LM Studio CLI 是否安装
```bash
lms --version
```

### 步骤 2: 检查当前已加载的模型
```bash
lms models loaded
# 或
lms ps
```

### 步骤 3: 检查模型是否已下载
```bash
lms models list | grep Qwen3-Embedding
```

### 步骤 4: 如果未下载，下载模型
```bash
lms models pull mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ
```

### 步骤 5: 加载模型
```bash
lms models load mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ
```

### 步骤 6: 验证模型已加载
```bash
lms models loaded
```

### 步骤 7: 测试 API
重新点击节点，验证 `/api/nodes/{id}/summary` 和 `/api/nodes/{id}/retrieval` 接口是否正常工作。

## 备选方案

如果 LM Studio CLI 未安装：
1. 打开 LM Studio 应用
2. 点击左下角设置 (Settings)
3. 选择 'CLI' 标签页
4. 点击 'Install CLI' 按钮

或者使用项目提供的运维脚本：
```bash
./scripts/service.sh check-models  # 检查模型
./scripts/service.sh start-models  # 加载模型
```
