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
   * Detect server configuration (simplified version)
   * @param {string} serverPath - MCP server path
   * @returns {Object} Server configuration information
   */
  detectServerConfig(serverPath) {
    // Handle NPX commands
    if (serverPath.startsWith("npx ")) {
      const parts = serverPath.split(" ");
      return {
        command: "npx",
        args: parts[0] === "npx" ? parts.slice(1) : parts,
        serverPath: serverPath,
      };
    }

    // Check if file exists
    if (!fs.existsSync(serverPath)) {
      throw new Error(`Server file does not exist: ${serverPath}`);
    }

    const ext = path.extname(serverPath).toLowerCase();
    let command, args;

    switch (ext) {
      case ".py":
        command = "python";
        args = [serverPath];
        break;
      case ".js":
        command = "node";
        args = [serverPath];
        break;
      case ".jar":
        command = "java";
        args = ["-jar", serverPath];
        break;
      default:
        // Try as executable
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
        version: "1.5.0",
      });

      // Connect - based on official documentation
      await this.client.connect(this.transport);

      this.isConnected = true;

      // Get server information
      await this.getServerCapabilities();

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
      const result = await this.client.callTool({
        name: name,
        arguments: toolArgs,
      });

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
   * @param {string|Array} toolName - Tool name or array of tool names
   * @returns {boolean} Whether tool(s) are available
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
   * Refresh server capability information
   * @returns {Promise<Object>} Updated server information
   */
  async refreshServerInfo() {
    return await this.getServerCapabilities();
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
}

module.exports = MCPClientHelper;
