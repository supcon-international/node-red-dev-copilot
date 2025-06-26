const path = require("path");
const MCPClientHelper = require(path.join(
  __dirname,
  "..",
  "mcp",
  "mcp-client.js"
));

// Import official SDKs
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = function (RED) {
  "use strict";

  function DevCopilotNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get configuration properties
    node.provider = config.provider || "openai";
    node.model = config.model || "gpt-4";
    node.mcpCommand = config.mcpCommand || "";
    node.mcpArgs = config.mcpArgs || "";
    node.mcpEnv = config.mcpEnv || "";
    node.systemPrompt =
      config.systemPrompt || "You are a helpful development assistant.";

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
        node.log(`🔧 Initializing ${node.provider} SDK client...`);

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
          case "anthropic":
            node.anthropicClient = new Anthropic({
              apiKey: node.apiKey,
              timeout: 30000,
            });
            break;
          case "google":
            node.googleClient = new GoogleGenerativeAI(node.apiKey);
            break;
          default:
            throw new Error(`Unsupported provider: ${node.provider}`);
        }

        node.log(`✅ ${node.provider} SDK client initialized successfully`);
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
    node.defaultSystemPrompt = `You are a development assistant integrated into Node-RED. 
You can help with:
- Node-RED flow development
- JavaScript/Node.js code analysis
- Debugging assistance
- Best practices recommendations
- Documentation generation

Please provide clear, actionable advice and code examples when appropriate.`;

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

        node.log(`🔌 Initializing MCP connection:`);
        node.log(`   Command: ${node.mcpCommand}`);
        if (args.length > 0) {
          node.log(`   Arguments: ${args.join(" ")}`);
        }
        if (Object.keys(env).length > 0) {
          node.log(`   Environment variables: ${JSON.stringify(env)}`);
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

          node.log(`✅ MCP server connected successfully`);
          node.log(`   Tools count: ${serverInfo.tools.length}`);
          node.log(`   Resources count: ${serverInfo.resources.length}`);

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
          node.log("🔌 MCP server connection disconnected");
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

          node.log(
            `🔧 Found ${tools.length} MCP tools: ${mcpTools
              .map((t) => t.name)
              .join(", ")}`
          );
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

        node.log(`🤖 Calling ${node.provider} API, model: ${node.model}`);

        switch (node.provider.toLowerCase()) {
          case "openai":
          case "deepseek":
            return await node.callOpenAIWithTools(messages, availableTools);
          case "anthropic":
            return await node.callAnthropicWithTools(messages, availableTools);
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

    // OpenAI API call (with tool integration) - using official SDK
    node.callOpenAIWithTools = async function (messages, tools) {
      if (!node.openaiClient) {
        throw new Error("OpenAI client not initialized");
      }

      let conversationMessages = [...messages];
      let finalContent = [];
      let lastResponse = null;

      // Execute up to 5 rounds of tool calls to prevent infinite loops
      for (let round = 0; round < 5; round++) {
        const requestParams = {
          model: node.model,
          messages: conversationMessages,
          temperature: 0.7,
          max_tokens: 2000,
        };

        // If tools are available, add them to the request
        if (tools && tools.length > 0) {
          requestParams.tools = tools;
          requestParams.tool_choice = "auto";
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

    // Anthropic API call (with tool integration) - using official SDK
    node.callAnthropicWithTools = async function (messages, tools) {
      if (!node.anthropicClient) {
        throw new Error("Anthropic client not initialized");
      }

      const systemMessage = messages.find((m) => m.role === "system");
      let conversationMessages = messages.filter((m) => m.role !== "system");
      let finalContent = [];
      let lastResponse = null;

      // If no tools, use simple call
      if (!tools || tools.length === 0) {
        node.log(`📤 Anthropic API simple call - no tools`);

        const requestParams = {
          model: node.model,
          messages: conversationMessages,
          max_tokens: 2000,
        };

        if (systemMessage && systemMessage.content) {
          requestParams.system = systemMessage.content;
        }

        const response = await node.anthropicClient.messages.create(
          requestParams
        );
        const textContent = response.content.filter(
          (content) => content.type === "text"
        );
        const content = textContent.map((t) => t.text).join("\n");

        return {
          content: content,
          usage: response.usage || null,
        };
      }

      // Convert tool format to Anthropic format
      const anthropicTools = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));

      node.log(
        `📤 Anthropic API request - messages: ${conversationMessages.length}, tools: ${anthropicTools.length}`
      );

      // Execute up to 5 rounds of tool calls to prevent infinite loops
      for (let round = 0; round < 5; round++) {
        const requestParams = {
          model: node.model,
          messages: conversationMessages,
          max_tokens: 2000,
          tools: anthropicTools,
        };

        if (systemMessage && systemMessage.content) {
          requestParams.system = systemMessage.content;
        }

        const response = await node.anthropicClient.messages.create(
          requestParams
        );
        lastResponse = response;

        const responseContent = response.content;

        // Check if there are tool calls in the response
        const toolUses = responseContent.filter(
          (content) => content.type === "tool_use"
        );
        const textContent = responseContent.filter(
          (content) => content.type === "text"
        );

        // Add text content
        if (textContent.length > 0) {
          finalContent.push(textContent.map((t) => t.text).join("\n"));
        }

        if (toolUses.length > 0) {
          // Add assistant message to conversation history
          conversationMessages.push({
            role: "assistant",
            content: responseContent,
          });

          const toolResults = [];

          // Execute tool calls
          for (const toolUse of toolUses) {
            const toolName = toolUse.name;
            const toolArgs = toolUse.input;

            finalContent.push(`🔧 Calling tool: ${toolName}`);

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);

              // Format tool result
              const formattedResult = node.formatToolResult(toolResult);

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: formattedResult,
              });
            } catch (error) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Error: ${error.message}`,
              });

              finalContent.push(`❌ Tool call failed: ${error.message}`);
            }
          }

          // Add tool results to conversation
          conversationMessages.push({
            role: "user",
            content: toolResults,
          });

          // Continue conversation, let Claude process tool results
          continue;
        } else {
          // No tool calls, return final response
          break;
        }
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

    // Google Gemini API call (with tool integration) - using official SDK
    node.callGoogleWithTools = async function (messages, tools) {
      if (!node.googleClient) {
        throw new Error("Google client not initialized");
      }

      const systemInstruction = messages.find((m) => m.role === "system");
      let conversationMessages = messages.filter((m) => m.role !== "system");
      let finalContent = [];

      // Get model instance
      const model = node.googleClient.getGenerativeModel({ model: node.model });

      // If no tools, use simple call
      if (!tools || tools.length === 0) {
        node.log(`📤 Google API simple call - no tools`);

        // Build conversation history
        const history = [];
        for (let i = 0; i < conversationMessages.length - 1; i += 2) {
          if (conversationMessages[i] && conversationMessages[i + 1]) {
            history.push({
              role: "user",
              parts: [{ text: conversationMessages[i].content }],
            });
            history.push({
              role: "model",
              parts: [{ text: conversationMessages[i + 1].content }],
            });
          }
        }

        // Get the last user message
        const lastMessage =
          conversationMessages[conversationMessages.length - 1];
        if (!lastMessage || lastMessage.role !== "user") {
          throw new Error("Last message must be a user message");
        }

        const chat = model.startChat({
          history: history,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000,
          },
          systemInstruction: systemInstruction
            ? systemInstruction.content
            : undefined,
        });

        const result = await chat.sendMessage(lastMessage.content);
        const response = await result.response;

        return {
          content: response.text(),
          usage: response.usageMetadata || null,
        };
      }

      // Implement Google SDK tool calling functionality
      node.log(
        `📤 Google API request - messages: ${conversationMessages.length}, tools: ${tools.length}`
      );

      // Clean JSON Schema to adapt to Google API
      const cleanSchemaForGoogle = function (schema) {
        if (!schema || typeof schema !== "object") return schema;

        const cleaned = JSON.parse(JSON.stringify(schema)); // Deep copy

        // Recursively clean object
        function cleanObject(obj) {
          if (typeof obj !== "object" || obj === null) return obj;

          if (Array.isArray(obj)) {
            return obj.map(cleanObject);
          }

          // Remove fields not supported by Google API
          const unsupportedFields = [
            "$schema",
            "additionalProperties",
            "$ref",
            "definitions",
            "$id",
            "$comment",
          ];
          unsupportedFields.forEach((field) => {
            delete obj[field];
          });

          // Recursively process all properties
          for (const key in obj) {
            obj[key] = cleanObject(obj[key]);
          }

          return obj;
        }

        return cleanObject(cleaned);
      };

      // Convert tool format to Google format
      const googleTools = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: cleanSchemaForGoogle(tool.function.parameters),
      }));

      // Create model instance with tools
      const modelWithTools = node.googleClient.getGenerativeModel({
        model: node.model,
        tools: [{ functionDeclarations: googleTools }],
        systemInstruction: systemInstruction
          ? systemInstruction.content
          : undefined,
      });

      let lastResponse = null;

      // Execute up to 5 rounds of tool calls
      for (let round = 0; round < 5; round++) {
        // Build current conversation history
        const history = [];
        for (let i = 0; i < conversationMessages.length - 1; i += 2) {
          if (conversationMessages[i] && conversationMessages[i + 1]) {
            history.push({
              role: "user",
              parts: [{ text: conversationMessages[i].content }],
            });
            history.push({
              role: "model",
              parts: [{ text: conversationMessages[i + 1].content }],
            });
          }
        }

        const lastMessage =
          conversationMessages[conversationMessages.length - 1];
        if (!lastMessage || lastMessage.role !== "user") {
          throw new Error("Last message must be a user message");
        }

        const chat = modelWithTools.startChat({
          history: history,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000,
          },
        });

        const result = await chat.sendMessage(lastMessage.content);
        const response = await result.response;
        lastResponse = response;

        // Check if there are function calls
        let functionCalls = [];
        try {
          functionCalls = response.functionCalls() || [];
        } catch (error) {
          // If no function calls, an error will be thrown, which is normal
          node.log("🔍 Google API: No function calls detected");
          functionCalls = [];
        }

        if (functionCalls && functionCalls.length > 0) {
          // Has tool calls
          node.log(`🔧 Google API detected ${functionCalls.length} tool calls`);

          // Add model response to conversation history
          const responseText = response.text() || "[Function calls]";
          conversationMessages.push({
            role: "assistant",
            content: responseText,
          });

          const functionResponses = [];

          for (const functionCall of functionCalls) {
            const toolName = functionCall.name;
            const toolArgs = functionCall.args;

            finalContent.push(`🔧 Calling tool: ${toolName}`);

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);
              const formattedResult = node.formatToolResult(toolResult);

              functionResponses.push(
                `Function ${toolName} result: ${formattedResult}`
              );
            } catch (error) {
              functionResponses.push(
                `Function ${toolName} error: ${error.message}`
              );
              finalContent.push(`❌ Tool call failed: ${error.message}`);
            }
          }

          // Send tool call results
          const functionResponseMessage = functionResponses.join("\n\n");
          conversationMessages.push({
            role: "user",
            content: functionResponseMessage,
          });

          continue;
        } else {
          // No tool calls, return final response
          finalContent.push(response.text());
          break;
        }
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
    const path = require("path");
    const sidebarPath = path.join(__dirname, "..", "public", "sidebar.html");

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

      // Debug information
      console.log("🔍 Chat API debug info:");
      console.log(`   Requested nodeId: ${nodeId}`);
      console.log(`   Message content: ${message}`);

      // If no nodeId provided, try to find available node
      let node;
      if (nodeId) {
        node = RED.nodes.getNode(nodeId);
        console.log(`   Node lookup result: ${node ? "found" : "not found"}`);

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

          console.log("   All dev-copilot node status:", allNodes);

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
        console.log("   Auto-selected node:", node.name || node.id);
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
};
