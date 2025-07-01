# Node-RED Dev Copilot（Cursor-Like）

A Node-RED sidebar plugin integrating AI development assistant functionality with MCP (Model Context Protocol) support.

![Node-RED Dev Copilot](https://img.shields.io/badge/Node--RED-3.0%2B-red) ![MCP](https://img.shields.io/badge/MCP-Supported-blue) ![License](https://img.shields.io/badge/license-MIT-green)
[中文文档](README_zh.md)

## Features

- 🤖 **AI Development Assistant**: Integrates multiple LLM providers (OpenAI, Google, DeepSeek)
- 🔧 **MCP Protocol Support**: Supports Model Context Protocol for automatic tool discovery and execution
- 🎯 **Intelligent Tool Calling**: LLM automatically selects and executes tools based on requirements to get real-time data
- ⚡ **Automatic Function Calling**: All supported LLMs use automatic function calling for seamless tool integration
- 📱 **Sidebar UI**: Direct AI conversation within the Node-RED editor
- ⚙️ **Flexible Configuration**: Support for multiple node configurations with different AI settings for different projects
- 🔒 **Secure Credentials**: Uses Node-RED's credentials mechanism to securely store API keys
- 💬 **Multi-turn Conversations**: Supports context-aware continuous dialogue and tool chain calls
- 💾 **Message Persistence**: Chat history automatically saved with localStorage, survives page refreshes
- 🎯 **Smart Node Selection**: Automatically remembers and restores your last selected node
- 🗑️ **History Management**: One-click clear chat history functionality
- 🛠️ **Development-Focused**: Optimized prompts for Node-RED and JavaScript development
- 🚀 **Latest SDKs**: Uses latest official SDKs including Google Gen AI SDK v1.7+

## Latest Updates (v1.3.0)

### Core LLM Integration

- ✅ **Migrated to Google Gen AI SDK**: Updated from `@google/generative-ai` to `@google/genai@^1.7.0` following Google's official migration guide
- ✅ **Fixed Google API Tool Calling**: Completely rewritten Google API integration with correct SDK formats and automatic function calling
- ✅ **Automatic Function Calling**: Implemented automatic function calling for all LLM providers (OpenAI, Google, DeepSeek)
- ✅ **Enhanced Tool Integration**: Improved tool calling with better error handling and logging
- ✅ **Performance Optimization**: Faster and more reliable API calls using latest SDKs

### User Experience Enhancements

- ✅ **Message Persistence**: Chat history now automatically saves to localStorage and survives page refreshes
- ✅ **Smart Node Selection**: Automatically remembers and restores your last selected node on page reload
- ✅ **Silent Recovery**: Seamlessly restores conversation state without showing redundant welcome messages
- ✅ **History Management**: Added clear button to easily delete chat history for current node
- ✅ **Intelligent Fallback**: Gracefully handles localStorage limitations with fallback storage strategies

### Code Quality & Internationalization

- ✅ **Complete English Codebase**: All Chinese comments and messages have been translated to English for better international collaboration
- ✅ **Consistent Code Style**: Unified coding standards across all modules (mcp-client.js, dev-copilot.js, dev-copilot.html, sidebar.html)
- ✅ **Enhanced Maintainability**: Improved code readability with comprehensive English documentation
- ✅ **Developer Experience**: Better debugging with English console logs and error messages

## Installation

### Download from NODE-RED Manage Palette directly (Recommended)

### Install via NPM

```bash
cd ~/.node-red
npm install node-red-sidebar-dev-copilot
```

### Manual Installation

1. Clone the repository to the Node-RED user directory:

```bash
cd ~/.node-red
git clone https://github.com/supcon-international/node-red-sidebar-dev-copilot.git
cd node-red-sidebar-dev-copilot
npm install
```

2. Restart the Node-RED service

## Configuration

### 1. Add Dev Copilot Node

In the Node-RED editor:

1. Drag the "dev copilot" node from the "ai" category in the node panel to the flow
2. Double-click the node to configure

### 2. Basic Configuration

#### LLM Provider Settings

- **Provider**: Select AI provider (openai, google, deepseek)
- **Model**: Specify model name (e.g., gpt-4, gemini-1.5-pro, deepseek-chat)
- **API Key**: Enter the corresponding provider's API key (will be stored securely)
- **Temperature**: Controls randomness (0.0 = deterministic, 2.0 = very creative). For coding tasks, use 0.0-0.3
- **Max Tokens**: Maximum response length. For coding: 1000-2000 for snippets, 3000-4000 for complex solutions
- **Tool Call Limit**: Maximum rounds of tool calls to prevent infinite loops. For complex tasks, use 8-15

#### MCP Server Settings (Optional)

- **MCP Command**: MCP server startup command (e.g., npx @supcon-international/node-red-mcp-server)
- **Arguments**: Optional command line arguments, separated by spaces
- **Environment Variables**: Optional environment variables, format: KEY=value, multiple separated by commas
- **System Prompt**: Custom system prompt for AI interactions

### 3. Example Configurations

#### OpenAI Configuration

```
Provider: openai
Model: gpt-4
API Key: sk-...(your OpenAI API key)
Temperature: 0.1
Max Tokens: 2000
Tool Call Limit: 10
```

#### DeepSeek Configuration

```
Provider: deepseek
Model: deepseek-chat
API Key: sk-...(your DeepSeek API key)
Temperature: 0.1
Max Tokens: 2000
Tool Call Limit: 10
```

#### Google Configuration

```
Provider: google
Model: gemini-1.5-pro
API Key: ...(your Google API key)
Temperature: 0.1
Max Tokens: 2000
Tool Call Limit: 10
```

#### Using MCP Server

```
MCP Command: npx @supcon-international/node-red-mcp-server
Arguments: --port 3000 --verbose
Environment Variables: API_KEY=xxx,DEBUG=true
System Prompt: You are a Node-RED development assistant with MCP tools access.
```

## Usage

### Sidebar Chat

1. After configuring the node, click the "Dev Copilot" sidebar tab on the right side of Node-RED
2. Select the Dev Copilot node to use from the dropdown menu (your last selection will be automatically remembered)
3. Enter your question in the input box and press Enter to send
4. The AI will provide targeted development advice and code examples

**Enhanced Features:**

- 💾 **Persistent History**: Your chat conversations are automatically saved and will be restored when you return
- 🔄 **Auto-Recovery**: Page refreshes won't lose your conversation - everything picks up where you left off
- 🎯 **Smart Selection**: Your preferred node choice is remembered across sessions
- 🗑️ **Easy Cleanup**: Use the red "Clear" button to delete chat history for the current node when needed

### Flow Integration

The Dev Copilot node can also be used as a regular Node-RED node:

```javascript
// Input message format
msg = {
    payload: "How to create a HTTP request node in Node-RED?",
    history: [  // Optional conversation history
        {role: "user", content: "Previous question"},
        {role: "assistant", content: "Previous answer"}
    ]
}

// Output message format
msg = {
    payload: "AI response text",
    llm_config: {
        provider: "openai",
        model: "gpt-4",
        system_prompt: "..."
    },
    mcp_available: true,
    mcp_tools: [...]  // Available MCP tools list
}
```

## MCP Integration

### Supported MCP Features

- ✅ **Tools**: Call tools provided by MCP servers
- ✅ **Resources**: Access resources from MCP servers
- ✅ **Prompts**: Use prompt templates from MCP servers
- ✅ **Stdio Transport**: Communicate with MCP servers via stdio

### Common MCP Servers

```bash
# SUPCON Node-RED MCP Server (Recommended)
npx @supcon-international/node-red-mcp-server

# Filesystem server
npx -y @modelcontextprotocol/server-filesystem /path/to/project

# Git server
npx -y @modelcontextprotocol/server-git /path/to/repo

# SQLite server
npx -y @modelcontextprotocol/server-sqlite /path/to/database.db

# Browser automation
npx -y @modelcontextprotocol/server-puppeteer
```

## API Reference

### HTTP Endpoints

- `GET /dev-copilot/sidebar` - Get sidebar HTML
- `POST /dev-copilot/chat` - Send chat message
- `GET /dev-copilot/nodes` - Get available nodes list

### Node Configuration Properties

| Property      | Type        | Required | Description                                       |
| ------------- | ----------- | -------- | ------------------------------------------------- |
| name          | string      | No       | Node display name                                 |
| provider      | string      | Yes      | LLM provider (openai, google, deepseek)           |
| model         | string      | Yes      | Model name (e.g., gpt-4, gemini-1.5-pro)          |
| apiKey        | credentials | Yes      | API key for the selected provider                 |
| temperature   | number      | Yes      | Controls randomness (0.0-2.0, default: 0.1)       |
| maxTokens     | number      | Yes      | Maximum response length (100-8000, default: 2000) |
| toolCallLimit | number      | Yes      | Maximum tool call rounds (1-20, default: 10)      |
| mcpCommand    | string      | No       | MCP server startup command                        |
| mcpArgs       | string      | No       | MCP server command line arguments                 |
| mcpEnv        | string      | No       | Environment variables (KEY=value,KEY2=value2)     |
| systemPrompt  | string      | No       | Custom system prompt for AI interactions          |

## Development

### Project Structure

```
node-red-sidebar-dev-copilot/
├── package.json              # NPM package configuration
├── nodes/
│   ├── dev-copilot.js       # Node backend logic
│   └── dev-copilot.html     # Node frontend configuration
├── public/
│   └── sidebar.html         # Sidebar interface
├── mcp/
│   └── mcp-client.js        # MCP client helper class
└── README.md                # Documentation
```

### Local Development

1. Clone the project:

```bash
git clone https://github.com/supcon-international/node-red-sidebar-dev-copilot.git
cd node-red-sidebar-dev-copilot
```

2. Install dependencies:

```bash
npm install
```

3. Link to Node-RED:

```bash
cd ~/.node-red
npm link /path/to/node-red-sidebar-dev-copilot
```

4. Restart Node-RED for testing

### Testing MCP Connection

Use MCP Inspector to test server connection:
https://github.com/modelcontextprotocol/inspector

## Troubleshooting

### Common Issues

1. **Sidebar not displaying**

   - Check if Node-RED version is >=3.0.0
   - Confirm plugin is correctly installed
   - Check browser console for error messages

2. **MCP connection failed**

   - Verify MCP server path is correct
   - Check server parameter format
   - Use MCP Inspector to test server

3. **API call failed**

   - Confirm API key is valid
   - Check network connection
   - Verify model name is correct
   - Check if API quota is sufficient

4. **Chat history not saving**
   - Check if localStorage is enabled in browser
   - Verify not using private/incognito mode (data clears on session end)
   - Clear browser cache if localStorage appears corrupted
   - Check browser storage quota (usually 5-10MB limit)

### Debug Logs

Enable Node-RED debug logs:

```bash
DEBUG=* node-red
```

View Dev Copilot related logs:

```bash
DEBUG=node-red-sidebar-dev-copilot:* node-red
```

## Contributing

Issues and Pull Requests are welcome!

1. Fork the project
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Related Links

- [SUPCON International](https://www.supcon.com/)
- [Node-RED Official Website](https://nodered.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Support

If you have questions, please:

1. Check the [documentation](README.md)
2. Search [existing Issues](https://github.com/supcon-international/node-red-sidebar-dev-copilot/issues)
3. Create a new Issue describing the problem
4. Contact SUPCON technical support

---

**Made with ❤️ by SUPCON International**
