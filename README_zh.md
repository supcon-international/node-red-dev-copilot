# Node-RED Dev Copilot

一个为 Node-RED 开发的 AI 编程助手侧边栏插件，支持 MCP (Model Context Protocol) 协议。

![Node-RED Dev Copilot](https://img.shields.io/badge/Node--RED-3.0%2B-red) ![MCP](https://img.shields.io/badge/MCP-Supported-blue) ![License](https://img.shields.io/badge/license-MIT-green)

[English](README.md)

## 主要功能

- **多平台 AI 支持**: 支持 OpenAI、Google Gemini、DeepSeek 主流 AI 服务
- **MCP 协议集成**: 自动发现和调用 MCP 工具，结合我们的 Node-RED MCP 服务器，为 Node-RED 开发提供强大的 AI 辅助能力
- **智能工具调用**: AI 可以根据需要自动选择和执行相关工具
- **侧边栏界面**: 直接在 Node-RED 编辑器中使用，无需切换界面
- **多节点切换**: 支持在不同 LLM 节点之间自由切换，统一保留聊天历史记录
- **安全存储**: 使用 Node-RED 内置的凭证管理机制
- **对话记录**: 支持多轮对话，记录保存在 Node-RED 的全局存储中
- **Flow 节点**: 除了侧边栏，也可以作为 Flow 中的普通节点使用

## 快速开始

### 安装方式

**推荐**: 通过 Node-RED 的 Manage palette 搜索 `@supcon-international/node-red-dev-copilot`

或者使用 npm 安装：

```bash
cd ~/.node-red
npm install @supcon-international/node-red-dev-copilot
```

手动安装：

```bash
cd ~/.node-red
git clone https://github.com/supcon-international/node-red-sidebar-dev-copilot.git
cd node-red-sidebar-dev-copilot
npm install
```

安装完成后重启 Node-RED。

## 配置说明

### 基本设置

为了保存聊天记录，建议在 Node-RED 的 `settings.js` 中配置持久存储：

```javascript
// ~/.node-red/settings.js
contextStorage: {
    default: {
        module: "localfilesystem",
    }
},
```

这样配置后：

- 聊天记录会保存在文件中，重启后不丢失
- 多个浏览器可以共享聊天数据
- 数据存储在 `~/.node-red/context/global/global.json`

不配置也能正常使用，只是聊天记录只在当前会话有效。

### 添加和配置节点

1. 从节点面板的 "AI dev copilot" 分类拖拽 "dev copilot" 节点到画布
2. 双击节点进行配置

主要配置项：

**AI 服务设置**

- Provider: 选择 AI 提供商 (openai/google/deepseek)
- Model: 模型名称 (如 gpt-4, gemini-2.5-pro, deepseek-chat)
- API Key: 对应服务的 API 密钥
- Temperature: 随机性控制 (0-2, 编程建议用 0.1-0.3)
- Max Tokens: 最大回复长度 (建议 2000-4000)
- Tool Call Limit: 工具调用轮数限制 (建议 10-15)

**MCP 服务器设置** (可选)

- MCP Command: 服务器启动命令 (默认: `npx @supcon-international/node-red-mcp-server`)
- Arguments: 命令行参数
- Environment Variables: 环境变量 (格式: KEY=value,KEY2=value2)
- System Prompt: 自定义系统提示词

### 配置示例

**OpenAI 配置**

```
Provider: openai
Model: gpt-4
API Key: sk-xxx...
Temperature: 0.1
Max Tokens: 2000
```

**Google Gemini 配置**

```
Provider: google
Model: gemini-2.5-pro
API Key: AIxxx...
Temperature: 0.1
Max Tokens: 2000
```

**DeepSeek 配置**

```
Provider: deepseek
Model: deepseek-chat
API Key: sk-xxx...
Temperature: 0.1
Max Tokens: 2000
```

## 使用方法

### 侧边栏聊天

1. 配置好节点后，点击右侧的 "Dev Copilot" 标签
2. 选择要使用的节点（会记住上次的选择）
3. 输入问题，按回车发送
4. AI 会自动调用 MCP 工具来协助开发工作

聊天记录会自动保存，页面刷新后会恢复。使用 "Clear" 按钮可以清除所有记录。

### 作为 Flow 节点

也可以在 Flow 中作为普通节点使用：

```javascript
// 输入格式
{
    payload: "如何创建 HTTP 请求节点？",
    history: [  // 可选的对话历史
        {role: "user", content: "上一个问题"},
        {role: "assistant", content: "上一个回答"}
    ]
}

// 输出格式
{
    payload: "AI 的回答",
    llm_config: { provider: "openai", model: "gpt-4", ... },
    mcp_available: true,
    mcp_tools: [...]  // 可用的 MCP 工具列表
}
```

## MCP 集成

支持标准的 MCP 功能：

- Tools: 调用 MCP 服务器提供的工具
- Resources: 访问 MCP 服务器的资源
- Prompts: 使用 MCP 服务器的提示模板
- Stdio Transport: 通过标准输入输出与 MCP 服务器通信

推荐搭配使用我们开发的 Node-RED MCP 服务器：

```bash
npx @supcon-international/node-red-mcp-server
```

## API 接口

插件提供以下 HTTP 接口：

- `GET /dev-copilot/sidebar` - 获取侧边栏页面
- `POST /dev-copilot/chat` - 发送聊天消息
- `GET /dev-copilot/nodes` - 获取可用节点列表

## 开发相关

### 项目结构

```
node-red-dev-copilot/
├── package.json              # 包配置
├── nodes/
│   ├── dev-copilot.js       # 节点后端逻辑
│   └── dev-copilot.html     # 节点前端和侧边栏注册
├── public/
│   └── sidebar.html         # 侧边栏界面
├── mcp/
│   └── mcp-client.js        # MCP 客户端
└── README.md                # 文档
```

### 本地开发

```bash
git clone https://github.com/supcon-international/node-red-dev-copilot.git
cd node-red-dev-copilot
npm install

# 链接到 Node-RED
cd ~/.node-red
npm link /path/to/node-red-dev-copilot
```

然后重启 Node-RED 进行测试。

## 常见问题

**侧边栏不显示**

- 检查 Node-RED 版本 >= 3.0.0
- 确认插件安装正确
- 查看浏览器控制台是否有错误

**MCP 连接失败**

- 检查 MCP 服务器路径
- 验证参数格式是否正确
- 可以用 [MCP Inspector](https://github.com/modelcontextprotocol/inspector) 测试

**API 调用失败**

- 确认 API 密钥有效
- 检查网络连接
- 验证模型名称正确
- 确认 API 余额充足

**聊天记录不保存**

- 检查 settings.js 中的 contextStorage 配置
- 确认 Node-RED 对 context 目录有写权限
- 修改配置后需要重启 Node-RED

### 查看日志

```bash
# 查看 Node-RED 日志
tail -f ~/.node-red/node-red.log

# 启用详细日志
DEBUG=node-red:* node-red
```

## 后续计划

- 优化长对话的处理，避免响应变慢
- 添加 API 使用统计功能
- 改进缓存机制，减少重复调用
- 支持更多 MCP 服务器

## 参与贡献

欢迎提交 Issue 和 Pull Request。

标准流程：

1. Fork 这个项目
2. 创建功能分支 (`git checkout -b feature/new-feature`)
3. 提交修改 (`git commit -m 'Add some feature'`)
4. 推送到分支 (`git push origin feature/new-feature`)
5. 创建 Pull Request

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 技术支持

遇到问题可以：

1. 查看这份文档和 [英文文档](README.md)
2. 搜索 [已有的 Issues](https://github.com/supcon-international/node-red-sidebar-dev-copilot/issues)
3. 创建新的 Issue 描述问题

---
