const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("path");
const fs = require("fs");

/**
 * MCP 客户端辅助类 - 参考官方文档实现
 * 支持任意 MCP 服务器的连接和工具调用
 */
class MCPClientHelper {
  constructor() {
    this.client = null;
    this.transport = null;
    this.isConnected = false;
    this.serverInfo = null;
  }

  /**
   * 智能检测服务器类型和配置
   * @param {string} serverPath - MCP 服务器路径
   * @returns {Object} 服务器配置信息
   */
  detectServerConfig(serverPath) {
    const ext = path.extname(serverPath).toLowerCase();
    const basename = path.basename(serverPath);

    // 特殊处理：NPX 命令
    if (
      serverPath.startsWith("npx ") ||
      serverPath.includes("@modelcontextprotocol/") ||
      serverPath.includes("@node-red/")
    ) {
      const parts = serverPath.split(" ");
      if (parts[0] === "npx") {
        return {
          command: "npx",
          args: parts.slice(1),
          serverPath: serverPath,
        };
      } else {
        // 没有npx前缀，自动添加
        return {
          command: "npx",
          args: parts,
          serverPath: serverPath,
        };
      }
    }

    // 检测文件是否存在（除了NPX包）
    if (!fs.existsSync(serverPath)) {
      throw new Error(`服务器文件不存在: ${serverPath}`);
    }

    let command, args;

    if (ext === ".py") {
      // Python 服务器
      command = "python";
      args = [serverPath];
    } else if (ext === ".js") {
      // Node.js 服务器
      command = "node";
      args = [serverPath];
    } else if (ext === ".jar") {
      // Java 服务器
      command = "java";
      args = ["-jar", serverPath];
    } else if (basename.startsWith("npx") || serverPath.includes("npx")) {
      // NPX 包服务器 (如 @modelcontextprotocol/server-*)
      command = "npx";
      args = serverPath.split(" ").slice(1); // 移除 'npx' 部分
    } else if (fs.statSync(serverPath).isDirectory()) {
      // 目录 - 可能是 npm 项目
      const packageJson = path.join(serverPath, "package.json");
      if (fs.existsSync(packageJson)) {
        command = "npm";
        args = ["start"];
        process.chdir(serverPath); // 切换到项目目录
      } else {
        throw new Error(`目录 ${serverPath} 中没有找到 package.json`);
      }
    } else {
      // 尝试作为可执行文件
      command = serverPath;
      args = [];
    }

    return { command, args, serverPath };
  }

  /**
   * 连接到 MCP 服务器 - 简化版本，支持直接命令配置
   * @param {string} command - MCP 服务器启动命令
   * @param {string[]} args - 命令行参数
   * @param {Object} customEnv - 自定义环境变量
   * @returns {Promise<boolean>} 连接是否成功
   */
  async connect(command, args = [], customEnv = {}) {
    try {
      // 如果是旧版本调用（第一个参数是对象或包含路径的字符串），使用兼容模式
      if (
        typeof command === "object" ||
        (typeof command === "string" &&
          (command.includes("/") || command.includes("\\")))
      ) {
        return this.connectLegacy(command, args);
      }

      // 解析命令，处理 "npx package" 这样的情况
      let finalCommand, finalArgs;
      if (command.includes(" ")) {
        const parts = command.split(" ");
        finalCommand = parts[0];
        finalArgs = [...parts.slice(1), ...args];
      } else {
        finalCommand = command;
        finalArgs = args;
      }

      console.log(`🔌 连接到 MCP 服务器:`);
      console.log(`   命令: ${finalCommand}`);
      if (finalArgs.length > 0) {
        console.log(`   参数: ${finalArgs.join(" ")}`);
      }
      if (Object.keys(customEnv).length > 0) {
        console.log(`   环境变量: ${JSON.stringify(customEnv)}`);
      }

      // 合并环境变量
      const env = { ...process.env, ...customEnv };

      // 创建 transport - 参考官方文档
      this.transport = new StdioClientTransport({
        command: finalCommand,
        args: finalArgs,
        env: env,
      });

      // 创建客户端 - 参考官方文档
      this.client = new Client({
        name: "node-red-dev-copilot",
        version: "1.0.0",
      });

      // 连接 - 参考官方文档
      await this.client.connect(this.transport);

      this.isConnected = true;

      // 获取服务器信息
      await this.getServerCapabilities();

      console.log(
        `✅ MCP 客户端已连接到: ${finalCommand} ${finalArgs.join(" ")}`
      );
      return true;
    } catch (error) {
      console.error("❌ MCP 服务器连接失败:", error.message);
      this.isConnected = false;
      await this.cleanup();
      return false;
    }
  }

  /**
   * 兼容旧版本的连接方法
   * @param {string|Object} serverConfig - 服务器路径或配置对象
   * @param {string[]} additionalArgs - 额外参数
   * @returns {Promise<boolean>} 连接是否成功
   */
  async connectLegacy(serverConfig, additionalArgs = []) {
    try {
      let config;

      // 支持字符串路径或配置对象
      if (typeof serverConfig === "string") {
        config = this.detectServerConfig(serverConfig);
      } else {
        config = serverConfig;
      }

      // 合并额外参数
      const finalArgs = [...config.args, ...additionalArgs];

      return this.connect(config.command, finalArgs, {});
    } catch (error) {
      console.error("❌ MCP 服务器连接失败:", error.message);
      this.isConnected = false;
      await this.cleanup();
      return false;
    }
  }

  /**
   * 获取服务器能力信息
   */
  async getServerCapabilities() {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      // 并行获取所有可用信息
      const [toolsResponse, resourcesResponse, promptsResponse] =
        await Promise.allSettled([
          this.client.listTools(),
          this.client.listResources().catch(() => ({ resources: [] })),
          this.client.listPrompts().catch(() => ({ prompts: [] })),
        ]);

      this.serverInfo = {
        tools:
          toolsResponse.status === "fulfilled"
            ? toolsResponse.value.tools || []
            : [],
        resources:
          resourcesResponse.status === "fulfilled"
            ? resourcesResponse.value.resources || []
            : [],
        prompts:
          promptsResponse.status === "fulfilled"
            ? promptsResponse.value.prompts || []
            : [],
        connected: true,
        timestamp: new Date().toISOString(),
      };

      console.log(`📋 服务器能力:`);
      console.log(`   🔧 工具: ${this.serverInfo.tools.length} 个`);
      console.log(`   📁 资源: ${this.serverInfo.resources.length} 个`);
      console.log(`   💬 提示: ${this.serverInfo.prompts.length} 个`);

      // 详细列出工具
      if (this.serverInfo.tools.length > 0) {
        console.log(`   工具列表:`);
        this.serverInfo.tools.forEach((tool) => {
          console.log(`     - ${tool.name}: ${tool.description}`);
        });
      }

      return this.serverInfo;
    } catch (error) {
      console.error("获取服务器能力失败:", error.message);
      this.serverInfo = {
        tools: [],
        resources: [],
        prompts: [],
        connected: false,
      };
      return this.serverInfo;
    }
  }

  /**
   * 清理资源 - 参考官方文档的资源管理
   */
  async cleanup() {
    if (this.client && this.isConnected) {
      try {
        await this.client.close();
        console.log("🔌 MCP 客户端已断开连接");
      } catch (error) {
        console.error("断开 MCP 客户端连接时出错:", error.message);
      }
    }

    this.client = null;
    this.transport = null;
    this.isConnected = false;
    this.serverInfo = null;
  }

  /**
   * 断开连接 - 兼容性方法
   */
  async disconnect() {
    await this.cleanup();
  }

  /**
   * 列出可用的工具 - 参考官方文档实现
   * @returns {Promise<Array>} 工具列表
   */
  async listTools() {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP 客户端未连接");
    }

    try {
      const result = await this.client.listTools();
      return result.tools || [];
    } catch (error) {
      console.error("获取 MCP 工具列表失败:", error.message);
      throw new Error(`获取工具列表失败: ${error.message}`);
    }
  }

  /**
   * 调用工具 - 参考官方文档实现
   * @param {string} name - 工具名称
   * @param {Object} toolArgs - 工具参数
   * @returns {Promise<Object>} 工具执行结果
   */
  async callTool(name, toolArgs = {}) {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP 客户端未连接");
    }

    try {
      console.log(`🔧 调用 MCP 工具: ${name}`);
      console.log(`📝 参数:`, JSON.stringify(toolArgs, null, 2));

      const result = await this.client.callTool({
        name: name,
        arguments: toolArgs,
      });

      console.log(`✅ 工具调用成功: ${name}`);
      return result;
    } catch (error) {
      console.error(`❌ MCP 工具 ${name} 调用失败:`, error.message);

      // 提供更详细的错误信息
      if (error.code === -32603 && error.message.includes("Unknown tool")) {
        throw new Error(
          `工具 "${name}" 不存在。可用工具: ${
            this.serverInfo?.tools?.map((t) => t.name).join(", ") || "无"
          }`
        );
      } else if (error.code === -32001) {
        throw new Error(`工具 "${name}" 调用超时，请检查服务器状态`);
      } else {
        throw new Error(`工具 "${name}" 调用失败: ${error.message}`);
      }
    }
  }

  /**
   * 获取工具的详细信息
   * @param {string} toolName - 工具名称
   * @returns {Object|null} 工具信息
   */
  getToolInfo(toolName) {
    if (!this.serverInfo || !this.serverInfo.tools) {
      return null;
    }

    return this.serverInfo.tools.find((tool) => tool.name === toolName) || null;
  }

  /**
   * 检查工具是否可用
   * @param {string} toolName - 工具名称
   * @returns {boolean} 工具是否可用
   */
  hasTools(toolName) {
    if (Array.isArray(toolName)) {
      return toolName.every((name) => this.getToolInfo(name) !== null);
    }
    return this.getToolInfo(toolName) !== null;
  }

  /**
   * 列出可用的资源
   * @returns {Promise<Array>} 资源列表
   */
  async listResources() {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.listResources();
      return result.resources || [];
    } catch (error) {
      console.error("Failed to list MCP resources:", error);
      throw error;
    }
  }

  /**
   * 读取资源
   * @param {string} uri - 资源 URI
   * @returns {Promise<Object>} 资源内容
   */
  async readResource(uri) {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.readResource({ uri: uri });
      return result;
    } catch (error) {
      console.error(`Failed to read MCP resource ${uri}:`, error);
      throw error;
    }
  }

  /**
   * 列出可用的提示
   * @returns {Promise<Array>} 提示列表
   */
  async listPrompts() {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.listPrompts();
      return result.prompts || [];
    } catch (error) {
      console.error("Failed to list MCP prompts:", error);
      throw error;
    }
  }

  /**
   * 获取提示
   * @param {string} name - 提示名称
   * @param {Object} promptArgs - 提示参数
   * @returns {Promise<Object>} 提示内容
   */
  async getPrompt(name, promptArgs = {}) {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.getPrompt({
        name: name,
        arguments: promptArgs,
      });
      return result;
    } catch (error) {
      console.error(`Failed to get MCP prompt ${name}:`, error);
      throw error;
    }
  }

  /**
   * 获取连接状态
   * @returns {boolean} 是否已连接
   */
  isClientConnected() {
    return this.isConnected && this.client !== null;
  }

  /**
   * 获取服务器信息
   * @returns {Promise<Object>} 服务器信息
   */
  async getServerInfo() {
    return (
      this.serverInfo || {
        tools: [],
        resources: [],
        prompts: [],
        connected: this.isConnected,
      }
    );
  }

  /**
   * 刷新服务器能力信息
   * @returns {Promise<Object>} 更新后的服务器信息
   */
  async refreshServerInfo() {
    return await this.getServerCapabilities();
  }

  /**
   * 静态工厂方法 - 快速创建并连接客户端
   * @param {string|Object} serverConfig - 服务器配置
   * @param {string[]} additionalArgs - 额外参数
   * @returns {Promise<MCPClientHelper>} 已连接的客户端实例
   */
  static async createAndConnect(serverConfig, additionalArgs = []) {
    const client = new MCPClientHelper();
    const success = await client.connect(serverConfig, additionalArgs);

    if (!success) {
      throw new Error("无法连接到 MCP 服务器");
    }

    return client;
  }

  /**
   * 获取支持的服务器类型列表
   * @returns {Array} 支持的服务器类型
   */
  static getSupportedServerTypes() {
    return [
      { type: "python", extension: ".py", description: "Python MCP 服务器" },
      { type: "nodejs", extension: ".js", description: "Node.js MCP 服务器" },
      { type: "java", extension: ".jar", description: "Java MCP 服务器" },
      {
        type: "npx",
        command: "npx",
        description: "NPX 包服务器 (如 @modelcontextprotocol/server-*)",
      },
      { type: "directory", description: "npm 项目目录" },
      { type: "executable", description: "可执行文件" },
    ];
  }

  /**
   * 生成服务器配置示例
   * @returns {Array} 服务器配置示例
   */
  static getServerExamples() {
    return [
      {
        name: "Everything服务器 (测试用)",
        config: "npx @modelcontextprotocol/server-everything",
        description: "包含多种测试工具的示例服务器",
      },
      {
        name: "Node-RED MCP服务器",
        config: "npx @node-red/mcp-server",
        description: "Node-RED 官方 MCP 服务器",
      },
      {
        name: "Python 服务器",
        config: "/path/to/server.py",
        description: "Python 编写的 MCP 服务器",
      },
      {
        name: "Node.js 服务器",
        config: "/path/to/server.js",
        description: "Node.js 编写的 MCP 服务器",
      },
    ];
  }
}

module.exports = MCPClientHelper;
