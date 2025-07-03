const path = require("path");
const MCPClientHelper = require("../mcp/mcp-client.js");

// Import official SDKs
const OpenAI = require("openai");
const { GoogleGenAI } = require("@google/genai");

module.exports = function (RED) {
  "use strict";

  function DevCopilotNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get configuration properties
    node.provider = config.provider || "openai";
    node.model = config.model || "gpt-4";
    node.temperature = parseFloat(config.temperature) || 0.1;
    node.maxTokens = parseInt(config.maxTokens) || 2000;
    node.toolCallLimit = parseInt(config.toolCallLimit) || 10;
    node.mcpCommand =
      config.mcpCommand || "npx @supcon-international/node-red-mcp-server";
    node.mcpArgs = config.mcpArgs || "";
    node.mcpEnv = config.mcpEnv || "";
    node.systemPrompt = config.systemPrompt || "";

    // Get sensitive information (credentials)
    node.apiKey = node.credentials.apiKey || "";

    // Initialize LLM SDK clients
    node.initSDKClients = function () {
      if (!node.apiKey) {
        node.warn(
          `⚠️ Cannot initialize ${node.provider} SDK: API key is empty`
        );
        return;
      }

      try {
        switch (node.provider.toLowerCase()) {
          case "openai":
            node.openaiClient = new OpenAI({
              apiKey: node.apiKey,
              timeout: 30000,
            });
            break;
          case "deepseek":
            node.openaiClient = new OpenAI({
              apiKey: node.apiKey,
              baseURL: "https://api.deepseek.com",
              timeout: 30000,
            });
            break;
          case "google":
            node.googleClient = new GoogleGenAI({ apiKey: node.apiKey });
            break;
          default:
            throw new Error(`Unsupported provider: ${node.provider}`);
        }
      } catch (error) {
        node.error(
          `❌ ${node.provider} SDK client initialization failed: ${error.message}`
        );
        node.error(
          `Debug info: Provider=${node.provider}, Has API key=${!!node.apiKey}`
        );
      }
    };

    // MCP client instance - using new MCPClientHelper
    node.mcpClient = new MCPClientHelper();

    // System prompt (default)
    node.defaultSystemPrompt = `You are a node-red dev copilot integrated into Node-RED. Developed by SUPCON-INTERNATIONAL`;

    // Initialize MCP connection - simplified configuration
    node.initMCP = async function () {
      if (!node.mcpCommand) {
        node.warn("MCP command not configured");
        node.status({
          fill: "yellow",
          shape: "ring",
          text: "no MCP configured",
        });
        return false;
      }

      try {
        // Parse arguments
        const args = node.mcpArgs
          ? node.mcpArgs.split(" ").filter((arg) => arg.trim())
          : [];

        // Parse environment variables
        let env = {};
        if (node.mcpEnv) {
          const envPairs = node.mcpEnv.split(",");
          for (const pair of envPairs) {
            const [key, value] = pair.split("=").map((s) => s.trim());
            if (key && value) {
              env[key] = value;
            }
          }
        }

        // Connect to MCP server
        const success = await node.mcpClient.connect(
          node.mcpCommand,
          args,
          env
        );

        if (success) {
          // Get server information
          const serverInfo = await node.mcpClient.getServerInfo();

          node.status({
            fill: "green",
            shape: "dot",
            text: `MCP: ${serverInfo.tools.length} tools`,
          });

          return true;
        } else {
          throw new Error("Connection failed");
        }
      } catch (error) {
        node.error(`❌ MCP server connection failed: ${error.message}`);
        node.status({
          fill: "red",
          shape: "ring",
          text: "MCP connection failed",
        });
        return false;
      }
    };

    // Disconnect MCP connection
    node.disconnectMCP = async function () {
      if (node.mcpClient && node.mcpClient.isClientConnected()) {
        try {
          await node.mcpClient.cleanup();
          node.status({ fill: "grey", shape: "ring", text: "disconnected" });
        } catch (error) {
          node.error("Error disconnecting MCP server: " + error.message);
        }
      }
    };

    // Get MCP tools list - using new client helper
    node.getMCPTools = async function () {
      const tools = [];

      if (node.mcpClient && node.mcpClient.isClientConnected()) {
        try {
          const mcpTools = await node.mcpClient.listTools();

          // Convert MCP tool format to LLM API tool format
          for (const tool of mcpTools) {
            tools.push({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            });
          }
        } catch (error) {
          node.warn("Failed to get MCP tools list: " + error.message);
        }
      }

      return tools;
    };

    // Execute MCP tool call - using new client helper
    node.executeMCPTool = async function (toolName, toolArgs) {
      if (!node.mcpClient || !node.mcpClient.isClientConnected()) {
        throw new Error("MCP client not connected");
      }

      try {
        const result = await node.mcpClient.callTool(toolName, toolArgs);
        return result;
      } catch (error) {
        node.error(`MCP tool call failed ${toolName}: ${error.message}`);
        throw error;
      }
    };

    // Format tool result - ensure compliance with LLM API requirements
    node.formatToolResult = function (toolResult) {
      let resultContent;

      try {
        if (toolResult && toolResult.content) {
          if (Array.isArray(toolResult.content)) {
            // If it's an array, extract text content
            resultContent = toolResult.content
              .map((item) => {
                if (typeof item === "string") return item;
                if (item && typeof item === "object") {
                  if (item.type === "text" && item.text) return item.text;
                  return JSON.stringify(item);
                }
                return String(item);
              })
              .join("\n");
          } else if (typeof toolResult.content === "string") {
            resultContent = toolResult.content;
          } else if (typeof toolResult.content === "object") {
            resultContent = JSON.stringify(toolResult.content, null, 2);
          } else {
            resultContent = String(toolResult.content);
          }
        } else {
          resultContent = JSON.stringify(toolResult || "No result");
        }

        // Return complete result without truncation
        return resultContent;
      } catch (error) {
        return `Error formatting result: ${error.message}`;
      }
    };

    // Call LLM API (integrated with MCP tools)
    node.callLLM = async function (messages) {
      if (!node.apiKey) {
        throw new Error(
          `API key not configured, please set ${node.provider} API key in node configuration`
        );
      }

      try {
        // Get available MCP tools
        const availableTools = await node.getMCPTools();

        switch (node.provider.toLowerCase()) {
          case "openai":
          case "deepseek":
            return await node.callOpenAIWithTools(messages, availableTools);
          case "google":
            return await node.callGoogleWithTools(messages, availableTools);

          default:
            throw new Error(`Unsupported LLM provider: ${node.provider}`);
        }
      } catch (error) {
        node.error(`LLM API call failed (${node.provider}): ${error.message}`);

        // Print detailed error information for debugging
        if (error.response) {
          node.error(`API response status: ${error.response.status}`);
          node.error(
            `API response data: ${JSON.stringify(error.response.data)}`
          );
        }

        // If API call fails, return error message instead of crashing
        return {
          content: `❌ LLM API call failed (${node.provider}): ${error.message}\n\nPlease check:\n1. API key is correct\n2. Network connection is working\n3. Model name is valid\n4. API quota is sufficient`,
          error: true,
        };
      }
    };

    // OpenAI API call (with tool integration) - using official SDK with automatic function calling
    node.callOpenAIWithTools = async function (messages, tools) {
      if (!node.openaiClient) {
        throw new Error("OpenAI client not initialized");
      }

      let conversationMessages = [...messages];
      let finalContent = [];
      let lastResponse = null;

      // Execute up to configured rounds of tool calls to prevent infinite loops
      const maxRounds = node.toolCallLimit || 10;

      let round = 0;
      let hitLimit = false;

      for (round = 0; round < maxRounds; round++) {
        const requestParams = {
          model: node.model,
          messages: conversationMessages,
          temperature: node.temperature || 0.1,
          max_tokens: node.maxTokens || 2000,
        };

        // If tools are available, add them to the request with automatic function calling
        if (tools && tools.length > 0) {
          requestParams.tools = tools;
          requestParams.tool_choice = "auto"; // Enable automatic function calling
        }

        const response = await node.openaiClient.chat.completions.create(
          requestParams
        );
        lastResponse = response;

        const message = response.choices[0].message;
        conversationMessages.push(message);

        // Check if there are tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          // Execute tool calls
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            finalContent.push(`🔧 Calling tool: ${toolName}`);

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);
              const formattedResult = node.formatToolResult(toolResult);

              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: formattedResult,
              });
            } catch (error) {
              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error: ${error.message}`,
              });

              finalContent.push(`❌ Tool call failed: ${error.message}`);
            }
          }

          continue;
        } else {
          finalContent.push(message.content);
          break;
        }
      }

      // Check if we hit the tool call limit for OpenAI
      if (round >= maxRounds) {
        hitLimit = true;
        node.warn(
          `⚠️ OpenAI: Reached tool call limit (${maxRounds} rounds) - response may be incomplete`
        );
        finalContent.push(
          `⚠️ Reached maximum tool calls (${maxRounds}), response may be incomplete`
        );
      }

      // Separate tool calls from final content
      const toolCallsInfo = finalContent
        .filter((line) => line.startsWith("🔧") || line.startsWith("❌"))
        .join("\n\n");
      const aiResponse = finalContent
        .filter((line) => !line.startsWith("🔧") && !line.startsWith("❌"))
        .join("\n\n");

      // Combine tool calls info and AI response
      const displayContent = toolCallsInfo
        ? `${toolCallsInfo}\n\n${aiResponse}`
        : aiResponse;

      return {
        content: displayContent,
        usage: lastResponse ? lastResponse.usage : null,
      };
    };

    // Google Gemini API call (with tool integration) - using latest Gen AI SDK v1.7+
    node.callGoogleWithTools = async function (messages, tools) {
      if (!node.googleClient) {
        throw new Error("Google client not initialized");
      }

      const systemInstruction = messages.find((m) => m.role === "system");
      let conversationMessages = messages.filter((m) => m.role !== "system");
      let finalContent = [];

      // Convert messages to Google format
      const contents = conversationMessages.map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));

      // If no tools, use simple call
      if (!tools || tools.length === 0) {
        try {
          const response = await node.googleClient.models.generateContent({
            model: node.model,
            contents: contents,
            config: {
              temperature: node.temperature || 0.1,
              maxOutputTokens: node.maxTokens || 2000,
              systemInstruction: systemInstruction
                ? systemInstruction.content
                : undefined,
            },
          });

          return {
            content: response.text,
            usage: response.usageMetadata || null,
          };
        } catch (error) {
          throw new Error(`Google API simple call failed: ${error.message}`);
        }
      }

      // Convert tools to Google format (functionDeclarations)
      const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      }));

      let lastResponse = null;

      // Execute up to configured rounds of tool calls to prevent infinite loops
      const maxRounds = node.toolCallLimit || 10;

      let round = 0;
      let hitLimit = false;

      for (round = 0; round < maxRounds; round++) {
        try {
          // Use the latest Gen AI SDK config format
          const config = {
            tools: [{ functionDeclarations: functionDeclarations }],
            temperature: node.temperature || 0.1,
            maxOutputTokens: node.maxTokens || 2000,
            systemInstruction: systemInstruction
              ? systemInstruction.content
              : undefined,
          };

          const response = await node.googleClient.models.generateContent({
            model: node.model,
            contents: contents,
            config: config,
          });

          lastResponse = response;

          // Check if there are function calls in the response
          let functionCalls = [];
          try {
            if (response.functionCalls && response.functionCalls.length > 0) {
              functionCalls = response.functionCalls;
            } else if (
              response.candidates &&
              response.candidates[0] &&
              response.candidates[0].content
            ) {
              // Check for function calls in the content parts
              const content = response.candidates[0].content;
              if (content.parts) {
                for (const part of content.parts) {
                  if (part.functionCall) {
                    functionCalls.push(part.functionCall);
                  }
                }
              }
            }
          } catch (error) {
            functionCalls = [];
          }

          if (functionCalls && functionCalls.length > 0) {
            // Has tool calls

            // Add model response to conversation
            const modelContent = {
              role: "model",
              parts: [],
            };

            // Add text response if available
            if (response.text) {
              modelContent.parts.push({ text: response.text });
            }

            // Add function calls
            for (const functionCall of functionCalls) {
              modelContent.parts.push({ functionCall: functionCall });
            }

            contents.push(modelContent);

            const functionResponses = [];

            for (const functionCall of functionCalls) {
              const toolName = functionCall.name;
              const toolArgs =
                functionCall.args || functionCall.arguments || {};

              finalContent.push(`🔧 Calling tool: ${toolName}`);

              try {
                const toolResult = await node.executeMCPTool(
                  toolName,
                  toolArgs
                );
                const formattedResult = node.formatToolResult(toolResult);

                functionResponses.push({
                  functionResponse: {
                    name: toolName,
                    response: {
                      result: formattedResult,
                    },
                  },
                });
              } catch (error) {
                functionResponses.push({
                  functionResponse: {
                    name: toolName,
                    response: {
                      error: error.message,
                    },
                  },
                });
                finalContent.push(`❌ Tool call failed: ${error.message}`);
              }
            }

            // Add tool results to conversation
            contents.push({
              role: "user",
              parts: functionResponses,
            });

            continue;
          } else {
            // No tool calls, return final response
            finalContent.push(response.text || "No response generated");
            break;
          }
        } catch (error) {
          throw new Error(`Google API call failed: ${error.message}`);
        }
      }

      // Check if we hit the tool call limit for Google API
      if (round >= maxRounds) {
        hitLimit = true;
        node.warn(
          `⚠️ Google: Reached tool call limit (${maxRounds} rounds) - response may be incomplete`
        );
        finalContent.push(
          `⚠️ Reached maximum tool calls (${maxRounds}), response may be incomplete`
        );
      }

      // Separate tool calls from final content
      const toolCallsInfo = finalContent
        .filter((line) => line.startsWith("🔧") || line.startsWith("❌"))
        .join("\n\n");
      const aiResponse = finalContent
        .filter((line) => !line.startsWith("🔧") && !line.startsWith("❌"))
        .join("\n\n");

      // Combine tool calls info and AI response
      const displayContent = toolCallsInfo
        ? `${toolCallsInfo}\n\n${aiResponse}`
        : aiResponse;

      return {
        content: displayContent,
        usage: lastResponse ? lastResponse.usageMetadata || null : null,
      };
    };

    // Process input messages
    node.on("input", async function (msg) {
      try {
        node.status({ fill: "blue", shape: "dot", text: "processing" });

        // Build message history
        const messages = [
          {
            role: "system",
            content: node.systemPrompt || node.defaultSystemPrompt,
          },
        ];

        // Add user message
        if (msg.payload) {
          messages.push({
            role: "user",
            content:
              typeof msg.payload === "string"
                ? msg.payload
                : JSON.stringify(msg.payload),
          });
        }

        // If there are historical messages, add them to the conversation
        if (msg.history && Array.isArray(msg.history)) {
          messages.splice(1, 0, ...msg.history);
        }

        // Call LLM
        const response = await node.callLLM(messages);

        // Prepare output message
        const outputMsg = {
          ...msg,
          payload: response.content,
          llm_config: {
            provider: node.provider,
            model: node.model,
            system_prompt: node.systemPrompt || node.defaultSystemPrompt,
          },
          mcp_available: !!node.mcpClient,
        };

        // If MCP tools are available, add tool information
        if (node.mcpClient) {
          try {
            const tools = await node.getMCPTools();
            outputMsg.mcp_tools = tools.map((tool) => ({
              name: tool.function.name,
              description: tool.function.description,
              parameters: tool.function.parameters,
            }));
          } catch (error) {
            node.warn("Failed to list MCP tools: " + error.message);
          }
        }

        node.send(outputMsg);
        node.status({ fill: "green", shape: "dot", text: "completed" });
      } catch (error) {
        node.error("Error processing message: " + error.message);
        node.status({ fill: "red", shape: "ring", text: "error" });

        // Send error message
        const errorMsg = {
          ...msg,
          payload: "Error: " + error.message,
          error: error.message,
        };
        node.send(errorMsg);
      }
    });

    // Clean up resources when node is closed
    node.on("close", async function () {
      await node.disconnectMCP();
    });

    // Initialize SDK clients
    node.initSDKClients();

    // Try to connect to MCP on initialization
    if (node.mcpCommand) {
      setImmediate(() => {
        node.initMCP();
      });
    } else {
      // No MCP configured (this is normal)
      node.status({
        fill: "blue",
        shape: "ring",
        text: "ready (no MCP)",
      });
    }
  }

  // Register node
  RED.nodes.registerType("dev-copilot", DevCopilotNode, {
    credentials: {
      apiKey: { type: "password" },
    },
  });

  // Register sidebar
  RED.httpAdmin.get("/dev-copilot/sidebar", function (req, res) {
    const sidebarPath = path.join(__dirname, "../public/sidebar.html");

    // Check if file exists
    const fs = require("fs");
    if (fs.existsSync(sidebarPath)) {
      res.sendFile(sidebarPath);
    } else {
      RED.log.error("Dev Copilot sidebar file not found: " + sidebarPath);
      res.status(404).send("Sidebar file not found");
    }
  });

  // API endpoint: send message to copilot
  RED.httpAdmin.post("/dev-copilot/chat", async function (req, res) {
    try {
      const { message, nodeId, history } = req.body;

      // If no nodeId provided, try to find available node
      let node;
      if (nodeId) {
        node = RED.nodes.getNode(nodeId);

        if (!node) {
          // Provide more detailed debug information
          const allNodes = [];
          RED.nodes.eachNode(function (n) {
            if (n.type === "dev-copilot") {
              const runtimeNode = RED.nodes.getNode(n.id);
              allNodes.push({
                configId: n.id,
                runtimeExists: !!runtimeNode,
                name: n.name || "unnamed",
              });
            }
          });

          return res.status(404).json({
            error: `Selected node (ID: ${nodeId}) not found.\n\nPossible reasons:\n1. Node not properly deployed - please click "Deploy" button\n2. Node configuration has errors - please check node configuration\n3. Node ID expired - please reselect node\n\nDebug info:\nCurrent available nodes: ${
              allNodes.length
            }\n${allNodes
              .map(
                (n) =>
                  `- ${n.name} (Config ID: ${n.configId}, Runtime: ${
                    n.runtimeExists ? "✓" : "✗"
                  })`
              )
              .join("\n")}`,
          });
        }
      } else {
        // Find first available runtime dev-copilot node
        let foundNode = null;
        RED.nodes.eachNode(function (configNode) {
          if (configNode.type === "dev-copilot" && !foundNode) {
            const runtimeNode = RED.nodes.getNode(configNode.id);
            if (runtimeNode) {
              foundNode = runtimeNode;
            }
          }
        });

        if (!foundNode) {
          return res.status(404).json({
            error:
              "No available Dev Copilot nodes found. Please follow these steps:\n\n1️⃣ Create node: Drag 'dev copilot' node from left panel to canvas\n2️⃣ Configure node: Double-click node to configure LLM provider and API key\n3️⃣ Deploy node: Click red 'Deploy' button in upper right\n4️⃣ Refresh page: Reload sidebar\n5️⃣ Select node: Choose deployed node from dropdown above\n\n💡 Tip: Ensure node configuration is complete and successfully deployed",
          });
        }
        node = foundNode;
      }

      // Check node configuration
      if (!node.apiKey) {
        return res.status(400).json({
          error: `Node configuration incomplete: missing ${node.provider} API key. Please double-click node to configure.`,
        });
      }

      // Build messages
      const messages = [
        {
          role: "system",
          content: node.systemPrompt || node.defaultSystemPrompt,
        },
      ];

      if (history && Array.isArray(history)) {
        messages.push(...history);
      }

      messages.push({
        role: "user",
        content: message,
      });

      // Call LLM
      const response = await node.callLLM(messages);

      res.json({
        success: true,
        response: response.content,
        llm_config: {
          provider: node.provider,
          model: node.model,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // API endpoint: get available dev-copilot nodes
  RED.httpAdmin.get("/dev-copilot/nodes", function (req, res) {
    const nodes = [];

    // Get runtime node instances
    RED.nodes.eachNode(function (configNode) {
      if (configNode.type === "dev-copilot") {
        // Find corresponding runtime node instance
        const runtimeNode = RED.nodes.getNode(configNode.id);
        if (runtimeNode) {
          nodes.push({
            id: runtimeNode.id,
            name: runtimeNode.name || configNode.name || "Dev Copilot",
            provider: runtimeNode.provider || configNode.provider,
            model: runtimeNode.model || configNode.model,
            status: "deployed", // Has runtime instance means deployed
          });
        } else {
          // Configuration exists but not deployed
          nodes.push({
            id: configNode.id,
            name: configNode.name || "Dev Copilot",
            provider: configNode.provider,
            model: configNode.model,
            status: "not_deployed", // Not deployed
          });
        }
      }
    });

    res.json(nodes);
  });

  // API endpoint: get context data
  RED.httpAdmin.post("/dev-copilot/context/get", function (req, res) {
    try {
      const { key, nodeId } = req.body;

      if (!key) {
        return res.status(400).json({
          success: false,
          error: "Key is required",
        });
      }

      // Find any dev-copilot node instance to access global context
      let contextAccessNode = null;
      RED.nodes.eachNode(function (configNode) {
        if (configNode.type === "dev-copilot" && !contextAccessNode) {
          const runtimeNode = RED.nodes.getNode(configNode.id);
          if (runtimeNode) {
            contextAccessNode = runtimeNode;
          }
        }
      });

      if (!contextAccessNode) {
        return res.status(500).json({
          success: false,
          error: "No dev-copilot node available for context access",
        });
      }

      // Use the node's context to access configured storage (localfilesystem)
      const data = contextAccessNode.context().global.get(key) || null;

      res.json({
        success: true,
        data: data,
      });
    } catch (error) {
      console.error("❌ Failed to get context data:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // API endpoint: set context data
  RED.httpAdmin.post("/dev-copilot/context/set", function (req, res) {
    try {
      const { key, data, nodeId } = req.body;

      if (!key) {
        return res.status(400).json({
          success: false,
          error: "Key is required",
        });
      }

      // Find any dev-copilot node instance to access global context
      let contextAccessNode = null;
      RED.nodes.eachNode(function (configNode) {
        if (configNode.type === "dev-copilot" && !contextAccessNode) {
          const runtimeNode = RED.nodes.getNode(configNode.id);
          if (runtimeNode) {
            contextAccessNode = runtimeNode;
          }
        }
      });

      if (!contextAccessNode) {
        return res.status(500).json({
          success: false,
          error: "No dev-copilot node available for context access",
        });
      }

      // Use the node's context to save to configured storage (localfilesystem)
      contextAccessNode.context().global.set(key, data);

      res.json({
        success: true,
        message: "Context data saved successfully",
      });
    } catch (error) {
      console.error("❌ Failed to set context data:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // API endpoint: delete context data
  RED.httpAdmin.post("/dev-copilot/context/delete", function (req, res) {
    try {
      const { key, nodeId } = req.body;

      if (!key) {
        return res.status(400).json({
          success: false,
          error: "Key is required",
        });
      }

      // Find any dev-copilot node instance to access global context
      let contextAccessNode = null;
      RED.nodes.eachNode(function (configNode) {
        if (configNode.type === "dev-copilot" && !contextAccessNode) {
          const runtimeNode = RED.nodes.getNode(configNode.id);
          if (runtimeNode) {
            contextAccessNode = runtimeNode;
          }
        }
      });

      if (!contextAccessNode) {
        return res.status(500).json({
          success: false,
          error: "No dev-copilot node available for context access",
        });
      }

      // Use the node's context to delete from configured storage (localfilesystem)
      contextAccessNode.context().global.set(key, undefined);

      res.json({
        success: true,
        message: "Context data deleted successfully",
      });
    } catch (error) {
      console.error("❌ Failed to delete context data:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
};
