const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("path");
const fs = require("fs");

/**
 * MCP Client Helper Class - Implementation based on official documentation
 * Supports connection and tool calling for any MCP server
 */
class MCPClientHelper {
  constructor() {
    this.client = null;
    this.transport = null;
    this.isConnected = false;
    this.serverInfo = null;
  }

  /**
   * Intelligently detect server type and configuration
   * @param {string} serverPath - MCP server path
   * @returns {Object} Server configuration information
   */
  detectServerConfig(serverPath) {
    const ext = path.extname(serverPath).toLowerCase();
    const basename = path.basename(serverPath);

    // Special handling: NPX commands
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
        // No npx prefix, automatically add it
        return {
          command: "npx",
          args: parts,
          serverPath: serverPath,
        };
      }
    }

    // Check if file exists (except for NPX packages)
    if (!fs.existsSync(serverPath)) {
      throw new Error(`Server file does not exist: ${serverPath}`);
    }

    let command, args;

    if (ext === ".py") {
      // Python server
      command = "python";
      args = [serverPath];
    } else if (ext === ".js") {
      // Node.js server
      command = "node";
      args = [serverPath];
    } else if (ext === ".jar") {
      // Java server
      command = "java";
      args = ["-jar", serverPath];
    } else if (basename.startsWith("npx") || serverPath.includes("npx")) {
      // NPX package server (e.g. @modelcontextprotocol/server-*)
      command = "npx";
      args = serverPath.split(" ").slice(1); // Remove 'npx' part
    } else if (fs.statSync(serverPath).isDirectory()) {
      // Directory - possibly npm project
      const packageJson = path.join(serverPath, "package.json");
      if (fs.existsSync(packageJson)) {
        command = "npm";
        args = ["start"];
        process.chdir(serverPath); // Switch to project directory
      } else {
        throw new Error(`No package.json found in directory ${serverPath}`);
      }
    } else {
      // Try as executable file
      command = serverPath;
      args = [];
    }

    return { command, args, serverPath };
  }

  /**
   * Connect to MCP server - simplified version, supports direct command configuration
   * @param {string} command - MCP server startup command
   * @param {string[]} args - Command line arguments
   * @param {Object} customEnv - Custom environment variables
   * @returns {Promise<boolean>} Whether connection was successful
   */
  async connect(command, args = [], customEnv = {}) {
    try {
      // If it's a legacy call (first parameter is object or string containing paths), use compatibility mode
      if (
        typeof command === "object" ||
        (typeof command === "string" &&
          (command.includes("/") || command.includes("\\")))
      ) {
        return this.connectLegacy(command, args);
      }

      // Parse command, handle cases like "npx package"
      let finalCommand, finalArgs;
      if (command.includes(" ")) {
        const parts = command.split(" ");
        finalCommand = parts[0];
        finalArgs = [...parts.slice(1), ...args];
      } else {
        finalCommand = command;
        finalArgs = args;
      }

      console.log(`🔌 Connecting to MCP server:`);
      console.log(`   Command: ${finalCommand}`);
      if (finalArgs.length > 0) {
        console.log(`   Arguments: ${finalArgs.join(" ")}`);
      }
      if (Object.keys(customEnv).length > 0) {
        console.log(`   Environment variables: ${JSON.stringify(customEnv)}`);
      }

      // Merge environment variables
      const env = { ...process.env, ...customEnv };

      // Create transport - based on official documentation
      this.transport = new StdioClientTransport({
        command: finalCommand,
        args: finalArgs,
        env: env,
      });

      // Create client - based on official documentation
      this.client = new Client({
        name: "node-red-dev-copilot",
        version: "1.0.0",
      });

      // Connect - based on official documentation
      await this.client.connect(this.transport);

      this.isConnected = true;

      // Get server information
      await this.getServerCapabilities();

      console.log(
        `✅ MCP client connected to: ${finalCommand} ${finalArgs.join(" ")}`
      );
      return true;
    } catch (error) {
      console.error("❌ MCP server connection failed:", error.message);
      this.isConnected = false;
      await this.cleanup();
      return false;
    }
  }

  /**
   * Legacy connection method for backward compatibility
   * @param {string|Object} serverConfig - Server path or configuration object
   * @param {string[]} additionalArgs - Additional arguments
   * @returns {Promise<boolean>} Whether connection was successful
   */
  async connectLegacy(serverConfig, additionalArgs = []) {
    try {
      let config;

      // Support string path or configuration object
      if (typeof serverConfig === "string") {
        config = this.detectServerConfig(serverConfig);
      } else {
        config = serverConfig;
      }

      // Merge additional arguments
      const finalArgs = [...config.args, ...additionalArgs];

      return this.connect(config.command, finalArgs, {});
    } catch (error) {
      console.error("❌ MCP server connection failed:", error.message);
      this.isConnected = false;
      await this.cleanup();
      return false;
    }
  }

  /**
   * Get server capability information
   */
  async getServerCapabilities() {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      // Get all available information in parallel
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

      console.log(`📋 Server capabilities:`);
      console.log(`   🔧 Tools: ${this.serverInfo.tools.length}`);
      console.log(`   📁 Resources: ${this.serverInfo.resources.length}`);
      console.log(`   💬 Prompts: ${this.serverInfo.prompts.length}`);

      // List tools in detail
      if (this.serverInfo.tools.length > 0) {
        console.log(`   Tool list:`);
        this.serverInfo.tools.forEach((tool) => {
          console.log(`     - ${tool.name}: ${tool.description}`);
        });
      }

      return this.serverInfo;
    } catch (error) {
      console.error("Failed to get server capabilities:", error.message);
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
   * Clean up resources - based on official documentation resource management
   */
  async cleanup() {
    if (this.client && this.isConnected) {
      try {
        await this.client.close();
        console.log("🔌 MCP client disconnected");
      } catch (error) {
        console.error("Error disconnecting MCP client:", error.message);
      }
    }

    this.client = null;
    this.transport = null;
    this.isConnected = false;
    this.serverInfo = null;
  }

  /**
   * Disconnect - compatibility method
   */
  async disconnect() {
    await this.cleanup();
  }

  /**
   * List available tools - implementation based on official documentation
   * @returns {Promise<Array>} Tool list
   */
  async listTools() {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.listTools();
      return result.tools || [];
    } catch (error) {
      console.error("Failed to get MCP tools list:", error.message);
      throw new Error(`Failed to get tools list: ${error.message}`);
    }
  }

  /**
   * Call tool - implementation based on official documentation
   * @param {string} name - Tool name
   * @param {Object} toolArgs - Tool arguments
   * @returns {Promise<Object>} Tool execution result
   */
  async callTool(name, toolArgs = {}) {
    if (!this.isConnected || !this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      console.log(`🔧 Calling MCP tool: ${name}`);
      console.log(`📝 Arguments:`, JSON.stringify(toolArgs, null, 2));

      const result = await this.client.callTool({
        name: name,
        arguments: toolArgs,
      });

      console.log(`✅ Tool call successful: ${name}`);
      return result;
    } catch (error) {
      console.error(`❌ MCP tool ${name} call failed:`, error.message);

      // Provide more detailed error information
      if (error.code === -32603 && error.message.includes("Unknown tool")) {
        throw new Error(
          `Tool "${name}" does not exist. Available tools: ${
            this.serverInfo?.tools?.map((t) => t.name).join(", ") || "none"
          }`
        );
      } else if (error.code === -32001) {
        throw new Error(
          `Tool "${name}" call timeout, please check server status`
        );
      } else {
        throw new Error(`Tool "${name}" call failed: ${error.message}`);
      }
    }
  }

  /**
   * Get detailed information about a tool
   * @param {string} toolName - Tool name
   * @returns {Object|null} Tool information
   */
  getToolInfo(toolName) {
    if (!this.serverInfo || !this.serverInfo.tools) {
      return null;
    }

    return this.serverInfo.tools.find((tool) => tool.name === toolName) || null;
  }

  /**
   * Check if tool is available
   * @param {string} toolName - Tool name
   * @returns {boolean} Whether tool is available
   */
  hasTools(toolName) {
    if (Array.isArray(toolName)) {
      return toolName.every((name) => this.getToolInfo(name) !== null);
    }
    return this.getToolInfo(toolName) !== null;
  }

  /**
   * List available resources
   * @returns {Promise<Array>} Resource list
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
   * Read resource
   * @param {string} uri - Resource URI
   * @returns {Promise<Object>} Resource content
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
   * List available prompts
   * @returns {Promise<Array>} Prompt list
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
   * Get prompt
   * @param {string} name - Prompt name
   * @param {Object} promptArgs - Prompt arguments
   * @returns {Promise<Object>} Prompt content
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
   * Get connection status
   * @returns {boolean} Whether connected
   */
  isClientConnected() {
    return this.isConnected && this.client !== null;
  }

  /**
   * Get server information
   * @returns {Promise<Object>} Server information
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
   * Refresh server capability information
   * @returns {Promise<Object>} Updated server information
   */
  async refreshServerInfo() {
    return await this.getServerCapabilities();
  }

  /**
   * Static factory method - quickly create and connect client
   * @param {string|Object} serverConfig - Server configuration
   * @param {string[]} additionalArgs - Additional arguments
   * @returns {Promise<MCPClientHelper>} Connected client instance
   */
  static async createAndConnect(serverConfig, additionalArgs = []) {
    const client = new MCPClientHelper();
    const success = await client.connect(serverConfig, additionalArgs);

    if (!success) {
      throw new Error("Unable to connect to MCP server");
    }

    return client;
  }

  /**
   * Get supported server types list
   * @returns {Array} Supported server types
   */
  static getSupportedServerTypes() {
    return [
      { type: "python", extension: ".py", description: "Python MCP server" },
      { type: "nodejs", extension: ".js", description: "Node.js MCP server" },
      { type: "java", extension: ".jar", description: "Java MCP server" },
      {
        type: "npx",
        command: "npx",
        description: "NPX package server (e.g. @modelcontextprotocol/server-*)",
      },
      { type: "directory", description: "npm project directory" },
      { type: "executable", description: "executable file" },
    ];
  }

  /**
   * Generate server configuration examples
   * @returns {Array} Server configuration examples
   */
  static getServerExamples() {
    return [
      {
        name: "Everything server (for testing)",
        config: "npx @modelcontextprotocol/server-everything",
        description: "Example server containing various test tools",
      },
      {
        name: "Node-RED MCP server",
        config: "npx @node-red/mcp-server",
        description: "Node-RED official MCP server",
      },
      {
        name: "Python server",
        config: "/path/to/server.py",
        description: "MCP server written in Python",
      },
      {
        name: "Node.js server",
        config: "/path/to/server.js",
        description: "MCP server written in Node.js",
      },
    ];
  }
}

module.exports = MCPClientHelper;
