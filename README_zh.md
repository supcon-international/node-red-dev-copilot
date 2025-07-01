# Node-RED Dev Copilot

一个集成 AI 开发助手功能的 Node-RED 侧边栏插件，支持 MCP（Model Context Protocol）协议。

![Node-RED Dev Copilot](https://img.shields.io/badge/Node--RED-3.0%2B-red) ![MCP](https://img.shields.io/badge/MCP-Supported-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## 功能特性

- 🤖 **AI 开发助手**: 集成多种 LLM 提供商（OpenAI、Google、DeepSeek）
- 🔧 **MCP 协议支持**: 支持 Model Context Protocol，自动发现和调用 MCP 工具
- 🎯 **智能工具调用**: LLM 根据需求自动选择和执行工具，获取实时数据
- ⚡ **自动函数调用**: 所有支持的 LLM 都使用自动函数调用，实现无缝工具集成
- 📱 **侧边栏 UI**: 直接在 Node-RED 编辑器中进行 AI 对话
- ⚙️ **灵活配置**: 支持多节点配置，不同项目使用不同 AI 设置
- 🔒 **安全凭证**: 使用 Node-RED 的 credentials 机制安全存储 API 密钥
- 💬 **多轮对话**: 支持上下文感知的连续对话和工具链调用
- 💾 **消息持久化**: 聊天记录自动保存到本地存储，页面刷新不丢失
- 🎯 **智能节点选择**: 自动记住并恢复上次选择的节点
- 🗑️ **历史记录管理**: 一键清除当前节点的聊天记录
- 🛠️ **开发专用**: 针对 Node-RED 和 JavaScript 开发优化的提示词
- 🚀 **最新 SDK**: 使用最新官方 SDK，包括 Google Gen AI SDK v1.7+

## 最新更新 (v1.2.0)

### 核心 LLM 集成

- ✅ **迁移到 Google Gen AI SDK**: 从 `@google/generative-ai` 更新到 `@google/genai@^1.7.0`，遵循 Google 官方迁移指南
- ✅ **修复 Google API 工具调用**: 完全重写 Google API 集成，使用正确的 SDK 格式和自动函数调用
- ✅ **自动函数调用**: 为所有 LLM 提供商（OpenAI、Google、DeepSeek）实现自动函数调用
- ✅ **增强工具集成**: 改进工具调用，提供更好的错误处理和日志记录
- ✅ **性能优化**: 使用最新 SDK 实现更快、更可靠的 API 调用

### 用户体验增强

- ✅ **消息持久化**: 聊天记录现在自动保存到 localStorage，页面刷新后不丢失
- ✅ **智能节点选择**: 自动记住并在页面重新加载时恢复上次选择的节点
- ✅ **静默恢复**: 无缝恢复对话状态，不显示冗余的欢迎信息
- ✅ **历史记录管理**: 添加清除按钮，轻松删除当前节点的聊天记录
- ✅ **智能降级**: 优雅处理 localStorage 限制，提供备用存储策略

## 安装

### 通过 NPM 安装（推荐）

```bash
cd ~/.node-red
npm install node-red-sidebar-dev-copilot
```

### 手动安装

1. 克隆仓库到 Node-RED 用户目录：

```bash
cd ~/.node-red
git clone https://github.com/supcon-international/node-red-sidebar-dev-copilot.git
cd node-red-sidebar-dev-copilot
npm install
```

2. 重启 Node-RED 服务

## 配置

### 1. 添加 Dev Copilot 节点

在 Node-RED 编辑器中：

1. 从节点面板的"ai"分类中拖拽"dev copilot"节点到流程中
2. 双击节点进行配置

### 2. 基本配置

#### LLM 提供商设置

- **Provider**: 选择 AI 提供商（openai、google、deepseek）
- **Model**: 指定模型名称（如：gpt-4、gemini-1.5-pro、deepseek-chat）
- **API Key**: 输入对应提供商的 API 密钥（将安全存储）

#### MCP 服务器设置（可选）

- **MCP Server Path**: MCP 服务器可执行文件路径
- **MCP Server Args**: 服务器启动参数
- **System Prompt**: 自定义系统提示词

### 3. 示例配置

#### OpenAI 配置

```
Provider: openai
Model: gpt-4
API Key: sk-...（你的OpenAI API密钥）
```

#### DeepSeek 配置

```
Provider: deepseek
Model: deepseek-chat
API Key: sk-...（你的DeepSeek API密钥）
```

#### Google 配置

```
Provider: google
Model: gemini-1.5-pro
API Key: ...（你的Google API密钥）
```

#### 使用 MCP 服务器

```
MCP Server Path: npx
MCP Server Args: @supcon-international/node-red-mcp-server
System Prompt: You are a Node-RED development assistant with MCP tools access.
```

## 使用方法

### 侧边栏聊天

1. 配置完节点后，点击 Node-RED 右侧的"Dev Copilot"侧边栏标签
2. 从下拉菜单选择要使用的 Dev Copilot 节点（上次的选择会自动记住）
3. 在输入框中输入问题，按 Enter 发送
4. AI 将提供针对性的开发建议和代码示例

**增强功能：**

- 💾 **持久化历史**: 您的聊天对话会自动保存，再次访问时会自动恢复
- 🔄 **自动恢复**: 页面刷新不会丢失对话内容，一切从上次中断的地方继续
- 🎯 **智能选择**: 您偏好的节点选择会在各次会话中被记住
- 🗑️ **轻松清理**: 使用红色的"Clear"按钮可以删除当前节点的聊天记录

### 流程集成

Dev Copilot 节点也可以作为普通的 Node-RED 节点使用：

```javascript
// 输入消息格式
msg = {
    payload: "How to create a HTTP request node in Node-RED?",
    history: [  // 可选的对话历史
        {role: "user", content: "Previous question"},
        {role: "assistant", content: "Previous answer"}
    ]
}

// 输出消息格式
msg = {
    payload: "AI response text",
    llm_config: {
        provider: "openai",
        model: "gpt-4",
        system_prompt: "..."
    },
    mcp_available: true,
    mcp_tools: [...]  // 可用的MCP工具列表
}
```

## MCP 集成

### 支持的 MCP 功能

- ✅ **Tools**: 调用 MCP 服务器提供的工具
- ✅ **Resources**: 访问 MCP 服务器的资源
- ✅ **Prompts**: 使用 MCP 服务器的提示模板
- ✅ **Stdio Transport**: 通过 stdio 与 MCP 服务器通信

### NODE-RED MCP 服务器

```bash
# SUPCON Node-RED MCP 服务器（推荐）
npx @supcon-international/node-red-mcp-server
```

## API 参考

### HTTP 端点

- `GET /dev-copilot/sidebar` - 获取侧边栏 HTML
- `POST /dev-copilot/chat` - 发送聊天消息
- `GET /dev-copilot/nodes` - 获取可用节点列表

### 节点配置属性

| 属性          | 类型        | 必填 | 描述           |
| ------------- | ----------- | ---- | -------------- |
| name          | string      | 否   | 节点显示名称   |
| provider      | string      | 是   | LLM 提供商     |
| model         | string      | 是   | 模型名称       |
| apiKey        | credentials | 是   | API 密钥       |
| mcpServerPath | string      | 否   | MCP 服务器路径 |
| mcpServerArgs | string      | 否   | MCP 服务器参数 |
| systemPrompt  | string      | 否   | 系统提示词     |

## 开发

### 项目结构

```
node-red-sidebar-dev-copilot/
├── package.json              # NPM包配置
├── nodes/
│   ├── dev-copilot.js       # 节点后端逻辑
│   └── dev-copilot.html     # 节点前端配置
├── public/
│   └── sidebar.html         # 侧边栏界面
├── mcp/
│   └── mcp-client.js        # MCP客户端辅助类
└── README.md                # 说明文档
```

### 本地开发

1. 克隆项目：

```bash
git clone https://github.com/supcon-international/node-red-sidebar-dev-copilot.git
cd node-red-sidebar-dev-copilot
```

2. 安装依赖：

```bash
npm install
```

3. 链接到 Node-RED：

```bash
cd ~/.node-red
npm link /path/to/node-red-sidebar-dev-copilot
```

4. 重启 Node-RED 进行测试

### 测试 MCP 连接

使用 MCP Inspector 测试服务器连接：

```bash
npx @modelcontextprotocol/inspector npx -y @modelcontextprotocol/server-filesystem .
```

## 故障排除

### 常见问题

1. **侧边栏不显示**

   - 检查 Node-RED 版本是否>=3.0.0
   - 确认插件正确安装
   - 查看浏览器控制台错误信息

2. **MCP 连接失败**

   - 验证 MCP 服务器路径是否正确
   - 检查服务器参数格式
   - 使用 MCP Inspector 测试服务器

3. **API 调用失败**

   - 确认 API 密钥有效
   - 检查网络连接
   - 验证模型名称正确
   - 检查 API 配额是否充足

4. **聊天记录未保存**
   - 检查浏览器是否启用了 localStorage
   - 确认未使用隐私/无痕模式（数据在会话结束时清除）
   - 如果 localStorage 损坏，清除浏览器缓存
   - 检查浏览器存储配额（通常 5-10MB 限制）

### 调试日志

启用 Node-RED 调试日志：

```bash
DEBUG=* node-red
```

查看 Dev Copilot 相关日志：

```bash
DEBUG=node-red-sidebar-dev-copilot:* node-red
```

## 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 相关链接

- [Node-RED 官网](https://nodered.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [SUPCON 国际](https://www.supcon.com/)

## 支持

如有问题，请：

1. 查看[文档](README.md)
2. 搜索[已有 Issues](https://github.com/supcon-international/node-red-sidebar-dev-copilot/issues)
3. 创建新 Issue 描述问题
4. 联系 SUPCON 技术支持

---

**Made with ❤️ by SUPCON International**
