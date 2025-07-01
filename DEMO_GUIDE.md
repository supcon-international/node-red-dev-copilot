# Node-RED Dev Copilot 演示指南

本指南将演示如何使用 Node-RED Dev Copilot 插件的 MCP 工具集成功能。

## 🎯 功能概览

Node-RED Dev Copilot 现在支持：

- ✅ **真实 LLM API 调用**：OpenAI、Google、DeepSeek
- ✅ **最新 SDK 集成**：使用最新官方 SDK，包括 Google Gen AI SDK v1.7+
- ✅ **自动函数调用**：所有 LLM 提供商都支持自动函数调用，无需手动指定工具
- ✅ **MCP 工具集成**：自动发现和使用 MCP 服务器提供的工具
- ✅ **智能工具调用**：LLM 根据需求自动选择和执行工具
- ✅ **多轮对话**：支持基于工具结果的连续对话
- ✅ **英文界面**：完全英文化的用户界面，提供更好的国际化支持

## 🚀 演示步骤

### 1. 安装插件

```bash
cd ~/.node-red
npm install /path/to/node-red-sidebar-dev-copilot
node-red
```

### 2. 配置节点

在 Node-RED 编辑器中：

1. 从节点面板的 "ai" 分类中拖拽 "dev copilot" 节点到流程
2. 双击节点配置：
   - **Provider**: 选择 LLM 提供商（OpenAI/Google/DeepSeek）
   - **Model**: 选择具体模型
   - **API Key**: 输入你的 API 密钥
   - **MCP Server Path**: 配置 MCP 服务器（可选）
   - **System Prompt**: 自定义系统提示

### 3. 配置 MCP 服务器（可选）

如果你有 MCP 服务器，可以配置：

#### 示例：SUPCON Node-RED MCP 服务器（推荐）

```bash
# MCP Server Path: npx
# MCP Server Args: @supcon-international/node-red-mcp-server
```


### 4. 测试工具集成

点击右侧侧边栏的 "Dev Copilot" 标签，然后尝试这些对话：

#### 无工具时的对话

```
用户: 你有什么工具？
助手: 我目前没有连接到任何外部工具。我是一个AI助手，可以帮助您...
```

#### 有 MCP 工具时的对话

```
用户: 你有什么工具？
助手: 我有以下工具可用：
🔧 get_weather - 获取天气信息
🔧 calculator - 执行数学计算
🔧 file_read - 读取文件内容
...
```

#### 智能工具调用示例

```
用户: 北京的天气怎么样？

助手: 🔧 调用工具: get_weather
📝 参数: {"city": "北京"}
✅ 工具结果: {"temperature": "25°C", "condition": "晴朗"}

根据最新信息，北京今天的天气是晴朗的，温度为25°C，是个不错的天气！
```

## 🧪 测试脚本

项目包含多个测试脚本来验证功能：

### 基础测试

```bash
# 测试项目结构和配置
node tests/test-node-red-integration.js

# 测试 MCP 连接
node tests/test-mcp-connection.js

# 测试 LLM API
node tests/test-llm-api.js

# 测试 MCP-LLM 集成
node tests/test-mcp-llm-integration.js
```

## 🔧 支持的 MCP 服务器

### 推荐服务器

**SUPCON Node-RED MCP 服务器**（推荐）

   ```bash
   npx @supcon-international/node-red-mcp-server
   ```


### 自定义服务器

你可以开发自己的 MCP 服务器，参考 [MCP 文档](https://modelcontextprotocol.io/quickstart/server)。

## 🎨 演示场景

### 场景 1: 文件操作助手

配置文件系统 MCP 服务器，然后：

```
用户: 帮我查看项目目录下有什么文件
助手: [调用 file_list 工具]
      发现以下文件：
      - package.json
      - README.md
      - src/
      - tests/

用户: 读取 package.json 的内容
助手: [调用 file_read 工具]
      package.json 内容显示...
```

### 场景 2: 代码分析助手

```
用户: 分析这个项目的依赖关系
助手: [调用多个文件读取工具]
      根据 package.json 分析，这个项目的主要依赖包括...
      建议优化：...
```

### 场景 3: DeepSeek 推理助手

使用 DeepSeek 模型进行复杂推理：

```
用户: 帮我分析这个Node-RED流程的性能瓶颈
助手: [使用 DeepSeek 的强大推理能力]
      根据流程分析，发现以下潜在瓶颈：
      1. HTTP请求节点的并发限制
      2. 数据库查询的索引优化
      建议优化方案：...
```

### 场景 4: 天气查询助手

如果连接了天气 MCP 服务器：

```
用户: 今天适合户外活动吗？
助手: [调用 get_weather 工具]
      根据当前天气情况（晴朗，25°C），今天非常适合户外活动！
      建议：...
```

## 🐛 故障排除

### 常见问题

1. **"Failed to load Dev Copilot sidebar"**

   - 检查浏览器控制台错误信息
   - 重启 Node-RED 并清除浏览器缓存

2. **"API 密钥未配置"**

   - 确保在节点配置中正确输入了 API 密钥
   - 验证 API 密钥的有效性

3. **"MCP 客户端未连接"**

   - 检查 MCP 服务器路径和参数配置
   - 确保 MCP 服务器可以正常启动

4. **工具调用失败**
   - 检查 MCP 服务器是否正常运行
   - 查看 Node-RED 日志中的错误信息

### 调试技巧

1. **查看 Node-RED 日志**

   ```bash
   node-red --verbose
   ```

2. **使用 MCP Inspector**

   ```bash
   npx @modelcontextprotocol/inspector npx -y @modelcontextprotocol/server-everything
   ```

3. **检查浏览器控制台**
   - 打开浏览器开发者工具
   - 查看 Console 和 Network 标签

## 📚 扩展学习

- [MCP 协议文档](https://modelcontextprotocol.io/)
- [Node-RED 开发文档](https://nodered.org/docs/)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)

## 🎉 开始体验

现在你已经了解了如何使用 Node-RED Dev Copilot 的 MCP 工具集成功能！

试试问 AI（现在全部使用英文界面）：

- "What tools do you have?"
- "Help me analyze this project"
- "Check files in current directory"
- "Calculate 123 + 456"
- "Show me how to optimize this Node-RED flow"

享受与 AI 助手的智能对话吧！

## 🆕 最新更新

### V1.2.0 主要改进

- ✅ **迁移到 Google Gen AI SDK**：从 `@google/generative-ai` 更新到 `@google/genai`，遵循 Google 官方迁移指南
- ✅ **自动函数调用**：为所有 LLM 提供商（OpenAI、Google、DeepSeek）实现自动函数调用
- ✅ **改进工具集成**：增强工具调用，提供更好的错误处理和日志记录
- ✅ **性能优化**：使用最新 SDK 实现更快、更可靠的 API 调用

### V2.0 之前的改进

- ✅ **新增 DeepSeek 支持**：集成 DeepSeek API，提供强大的推理能力
- ✅ **完全英文化**：所有界面、提示和错误信息都使用英文
- ✅ **官方 SDK**：使用官方 SDK 替代手动 HTTP 请求，提供更好的稳定性
- ✅ **改进的错误处理**：更清晰的错误信息和调试支持
- ✅ **SUPCON MCP 服务器**：推荐使用 @supcon-international/node-red-mcp-server
- ✅ **代码清理**：移除了 Azure OpenAI 支持，简化配置选项
