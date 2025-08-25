const path = require("path");
const MCPClientHelper = require("../mcp/mcp-client.js");

// Import official SDKs
const OpenAI = require("openai");
const { GoogleGenAI } = require("@google/genai");

// Import system prompt from dedicated module
const { DEFAULT_SYSTEM_PROMPT } = require("../prompts/system-prompt.js");

// Get API prefix from environment variable
const API_PREFIX = process.env.NODE_HTTP_API_PREFIX
  ? process.env.NODE_HTTP_API_PREFIX + "/dev-copilot"
  : "/dev-copilot";

module.exports = function (RED) {
  "use strict";

  function DevCopilotNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get configuration properties
    node.mode = config.mode || "service";
    node.provider = config.provider || "openai";
    node.model = config.model || "gpt-4.1";
    node.customUrl = config.customUrl || "";
    node.temperature = parseFloat(config.temperature) || 0.1;
    node.maxTokens = parseInt(config.maxTokens) || 2000;
    node.toolCallLimit = parseInt(config.toolCallLimit) || 10;
    node.mcpCommand = config.mcpCommand || "";
    node.mcpArgs = config.mcpArgs || "";
    node.mcpEnv = config.mcpEnv || "";
    node.systemPrompt = config.systemPrompt || "";

    // Get sensitive information (credentials)
    node.apiKey = node.credentials.apiKey || "";

    // Shared function to embed tool history into messages
    node.embedToolHistory = function (messages, providerName = "LLM") {
      return messages.map((msg) => {
        if (msg._toolHistory && msg._toolHistory.length > 0) {
          const toolsToEmbed = msg._toolHistory;
          const toolHistoryText = toolsToEmbed
            .map(
              (tool) =>
                `[TOOL_HISTORY] ${tool.name}(${JSON.stringify(tool.args)}) -> ${
                  typeof tool.result === "string"
                    ? tool.result
                    : JSON.stringify(tool.result)
                }`
            )
            .join("\n");

          console.log(
            `🔍 [Dev-Copilot] Embedding tool history for ${providerName} (full): ${toolsToEmbed.length} tools`
          );

          return {
            ...msg,
            content: `${msg.content}\n\n${toolHistoryText}`,
          };
        }
        return msg;
      });
    };

    // Shared function to convert messages to Google format with tool history embedding
    node.convertToGoogleFormat = function (messages, providerName = "Google") {
      return messages.map((msg) => {
        let content = msg.content;

        if (msg._toolHistory && msg._toolHistory.length > 0) {
          const toolsToEmbed = msg._toolHistory;
          const toolHistoryText = toolsToEmbed
            .map(
              (tool) =>
                `[TOOL_HISTORY] ${tool.name}(${JSON.stringify(tool.args)}) -> ${
                  typeof tool.result === "string"
                    ? tool.result
                    : JSON.stringify(tool.result)
                }`
            )
            .join("\n");

          content = `${msg.content}\n\n${toolHistoryText}`;
        }

        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: content }],
        };
      });
    };

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
          case "custom":
            if (!node.customUrl) {
              node.warn(`⚠️ Cannot initialize Custom LLM: API URL is required`);
              return;
            }
            node.openaiClient = new OpenAI({
              apiKey: node.apiKey,
              baseURL: node.customUrl,
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

    // History management functions
    node.getHistoryKey = function () {
      if (node.mode === "service") {
        return "dev-copilot-service-history";
      } else {
        return `dev-copilot-flow-history-${node.id}`;
      }
    };

    node.getHistory = function () {
      const key = node.getHistoryKey();
      return node.context().global.get(key) || [];
    };

    node.saveHistory = function (history) {
      // Always truncate history before saving to prevent context length issues
      const truncatedHistory = node.truncateHistoryIfNeeded(history, 100000);

      const key = node.getHistoryKey();
      node.context().global.set(key, truncatedHistory, function (err) {
        if (err) {
          node.warn("Failed to save history: " + err.message);
        }
      });
    };

    // Truncate conversation history if it gets too long
    node.truncateHistoryIfNeeded = function (history, maxChars = 100000) {
      if (!Array.isArray(history) || history.length === 0) {
        return history;
      }

      // Calculate current total character count
      const currentChars = JSON.stringify(history).length;

      if (currentChars <= maxChars) {
        return history; // No truncation needed
      }

      console.log(
        `📏 [Context-Management] History too long (${currentChars} chars), truncating to ~${maxChars} chars`
      );

      // Always keep the first message if it exists (usually system or initial context)
      const preservedMessages = history.length > 0 ? [history[0]] : [];
      let remainingMessages = history.slice(1);

      // Calculate how much we need to remove
      let currentSize = JSON.stringify(preservedMessages).length;
      const targetSize = Math.floor(maxChars * 0.8); // Use 80% of max to leave some buffer

      // Remove old messages from the beginning until we're under the target
      while (remainingMessages.length > 0 && currentSize < targetSize) {
        const nextMessage = remainingMessages[0];
        const nextSize = currentSize + JSON.stringify(nextMessage).length;

        if (nextSize > targetSize && remainingMessages.length > 5) {
          // If adding this message would exceed target and we have >5 messages, stop
          break;
        }

        preservedMessages.push(nextMessage);
        remainingMessages = remainingMessages.slice(1);
        currentSize = nextSize;
      }

      // If we still have remaining messages, keep the most recent ones
      if (remainingMessages.length > 0) {
        // Keep last 10 messages to maintain recent context
        const recentMessages = remainingMessages.slice(-10);
        preservedMessages.push(...recentMessages);
      }

      const finalSize = JSON.stringify(preservedMessages).length;
      const removedCount = history.length - preservedMessages.length;

      console.log(
        `✂️ [Context-Management] Truncated ${removedCount} messages, reduced from ${currentChars} to ${finalSize} chars`
      );

      return preservedMessages;
    };

    // System prompt (default)
    node.defaultSystemPrompt = DEFAULT_SYSTEM_PROMPT;

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
          case "custom":
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

    // Call LLM API with streaming support
    node.callLLMStream = async function (messages, streamCallback) {
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
          case "custom":
            return await node.callOpenAIWithToolsStream(
              messages,
              availableTools,
              streamCallback
            );
          case "google":
            return await node.callGoogleWithToolsStream(
              messages,
              availableTools,
              streamCallback
            );

          default:
            throw new Error(`Unsupported LLM provider: ${node.provider}`);
        }
      } catch (error) {
        node.error(
          `LLM API streaming call failed (${node.provider}): ${error.message}`
        );

        const errorMessage = `❌ LLM API call failed (${node.provider}): ${error.message}\n\nPlease check:\n1. API key is correct\n2. Network connection is working\n3. Model name is valid\n4. API quota is sufficient`;

        if (streamCallback) {
          streamCallback({
            type: "content",
            content: errorMessage,
          });
          streamCallback({
            type: "end",
          });
        }

        return {
          content: errorMessage,
          error: true,
        };
      }
    };

    // OpenAI API call (with tool integration) - using official SDK with automatic function calling
    node.callOpenAIWithTools = async function (messages, tools) {
      if (!node.openaiClient) {
        throw new Error("OpenAI client not initialized");
      }

      // Embed tool history into message content for LLM visibility (full, no truncation)
      let conversationMessages = node.embedToolHistory([...messages], "OpenAI");

      let finalContent = [];
      let lastResponse = null;
      let toolHistory = []; // Track tool call history

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

            // Console output: Tool call
            console.log(`🔧 [Dev-Copilot] Tool Call: ${toolName}`, toolArgs);

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);
              const formattedResult = node.formatToolResult(toolResult);

              // Console output: Tool result (complete)
              console.log(
                `✅ [Dev-Copilot] Tool Result: ${toolName}`,
                formattedResult
              );

              // Add to tool history
              toolHistory.push({
                name: toolName,
                args: toolArgs,
                result: formattedResult,
              });

              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: formattedResult,
              });
            } catch (error) {
              // Console output: Tool error
              console.log(
                `❌ [Dev-Copilot] Tool Error: ${toolName}`,
                error.message
              );

              // Add error to tool history
              toolHistory.push({
                name: toolName,
                args: toolArgs,
                result: `Error: ${error.message}`,
              });

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
        toolHistory: toolHistory, // Include tool history in response
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
      let toolHistory = []; // Track tool call history

      // Convert messages to Google format (full tool history, no truncation)
      const contents = node.convertToGoogleFormat(conversationMessages);

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

          // Robust text extraction for models that may not set response.text
          let extractedText = response.text || "";
          try {
            if (
              !extractedText &&
              response.candidates &&
              response.candidates[0]
            ) {
              const candidate = response.candidates[0];
              if (candidate.content && candidate.content.parts) {
                extractedText = candidate.content.parts
                  .filter((part) => part.text)
                  .map((part) => part.text)
                  .join("");
              }
            }
          } catch (e) {
            // Ignore extraction errors and fall back to empty text
          }

          return {
            content: extractedText,
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

              // Console output: Tool call (Google)
              console.log(`🔧 [Dev-Copilot] Tool Call: ${toolName}`, toolArgs);

              try {
                const toolResult = await node.executeMCPTool(
                  toolName,
                  toolArgs
                );
                const formattedResult = node.formatToolResult(toolResult);

                // Console output: Tool result (Google, complete)
                console.log(
                  `✅ [Dev-Copilot] Tool Result: ${toolName}`,
                  formattedResult
                );

                // Add to tool history
                toolHistory.push({
                  name: toolName,
                  args: toolArgs,
                  result: formattedResult,
                });

                functionResponses.push({
                  functionResponse: {
                    name: toolName,
                    response: {
                      result: formattedResult,
                    },
                  },
                });
              } catch (error) {
                // Console output: Tool error (Google)
                console.log(
                  `❌ [Dev-Copilot] Tool Error: ${toolName}`,
                  error.message
                );

                // Add error to tool history
                toolHistory.push({
                  name: toolName,
                  args: toolArgs,
                  result: `Error: ${error.message}`,
                });

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
          } else {
            // No tool calls, return final response (robust extraction + fallback)
            let extractedText = response.text || "";
            try {
              if (
                !extractedText &&
                response.candidates &&
                response.candidates[0]
              ) {
                const candidate = response.candidates[0];
                if (candidate.content && candidate.content.parts) {
                  extractedText = candidate.content.parts
                    .filter((part) => part.text)
                    .map((part) => part.text)
                    .join("");
                }
              }
            } catch (e) {
              // Ignore extraction errors
            }

            // Fallback: if still no text, try a non-tool call once (reasoning models can omit text)
            if (!extractedText) {
              try {
                const fallback = await node.googleClient.models.generateContent(
                  {
                    model: node.model,
                    contents: contents,
                    config: {
                      temperature: node.temperature || 0.1,
                      maxOutputTokens: node.maxTokens || 2000,
                      systemInstruction: systemInstruction
                        ? systemInstruction.content
                        : undefined,
                    },
                  }
                );

                let fallbackText = fallback.text || "";
                if (
                  !fallbackText &&
                  fallback.candidates &&
                  fallback.candidates[0]
                ) {
                  const candidate = fallback.candidates[0];
                  if (candidate.content && candidate.content.parts) {
                    fallbackText = candidate.content.parts
                      .filter((part) => part.text)
                      .map((part) => part.text)
                      .join("");
                  }
                }
                extractedText = fallbackText;
              } catch (fallbackErr) {
                console.log(
                  `❌ [Gemini-Debug] Non-stream fallback (no-tools) failed: ${fallbackErr.message}`
                );
              }
            }

            finalContent.push(extractedText || "No response generated");
            break;
          }
        } catch (error) {
          throw new Error(`Google API call failed: ${error.message}`);
        }
      }

      // Check if we hit the tool call limit for Google API
      if (typeof round === "number" && round >= maxRounds) {
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
        toolHistory: toolHistory, // Include tool history in response
      };
    };

    // OpenAI API call with streaming support
    node.callOpenAIWithToolsStream = async function (
      messages,
      tools,
      streamCallback
    ) {
      if (!node.openaiClient) {
        throw new Error("OpenAI client not initialized");
      }

      // Embed tool history into message content for LLM visibility (full, no truncation)
      let conversationMessages = node.embedToolHistory(
        [...messages],
        "OpenAI Stream"
      );

      let finalContent = [];
      let lastResponse = null;
      let accumulatedContent = "";
      let toolHistory = []; // Track tool call history

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
          stream: true, // Enable streaming
        };

        // If tools are available, add them to the request with automatic function calling
        if (tools && tools.length > 0) {
          requestParams.tools = tools;
          requestParams.tool_choice = "auto";
        }

        const stream = await node.openaiClient.chat.completions.create(
          requestParams
        );

        let currentMessage = { content: "", tool_calls: [] };
        let isToolCallRound = false;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            currentMessage.content += delta.content;
            accumulatedContent += delta.content;

            // Stream content to callback
            if (streamCallback) {
              streamCallback({
                type: "content",
                content: delta.content,
              });
            }
          }

          if (delta?.tool_calls) {
            isToolCallRound = true;
            // Handle tool calls - for simplicity, we'll collect them and process after stream ends
            for (const toolCall of delta.tool_calls) {
              if (!currentMessage.tool_calls[toolCall.index]) {
                currentMessage.tool_calls[toolCall.index] = {
                  id: toolCall.id || "",
                  type: "function",
                  function: { name: "", arguments: "" },
                };
              }

              if (toolCall.function?.name) {
                currentMessage.tool_calls[toolCall.index].function.name +=
                  toolCall.function.name;
              }
              if (toolCall.function?.arguments) {
                currentMessage.tool_calls[toolCall.index].function.arguments +=
                  toolCall.function.arguments;
              }
            }
          }
        }

        // Add message to conversation
        conversationMessages.push({
          role: "assistant",
          content: currentMessage.content || null,
          tool_calls:
            currentMessage.tool_calls.length > 0
              ? currentMessage.tool_calls
              : undefined,
        });

        // Check if there are tool calls
        if (isToolCallRound && currentMessage.tool_calls.length > 0) {
          // Execute tool calls
          for (const toolCall of currentMessage.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs;

            try {
              toolArgs = JSON.parse(toolCall.function.arguments);
            } catch (e) {
              toolArgs = {};
            }

            const toolMessage = `🔧 Calling tool: ${toolName}`;
            finalContent.push(toolMessage);

            // Console output: Tool call (Stream)
            console.log(
              `🔧 [Dev-Copilot] Tool Call (Stream): ${toolName}`,
              toolArgs
            );

            if (streamCallback) {
              streamCallback({
                type: "tool",
                content: toolMessage,
              });
            }

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);
              const formattedResult = node.formatToolResult(toolResult);

              // Console output: Tool result (Stream)
              console.log(
                `✅ [Dev-Copilot] Tool Result (Stream): ${toolName}`,
                formattedResult
              );

              // Add to tool history
              toolHistory.push({
                name: toolName,
                args: toolArgs,
                result: formattedResult,
              });

              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: formattedResult,
              });
            } catch (error) {
              // Console output: Tool error (Stream)
              console.log(
                `❌ [Dev-Copilot] Tool Error (Stream): ${toolName}`,
                error.message
              );

              const errorMessage = `❌ Tool call failed: ${error.message}`;
              finalContent.push(errorMessage);

              // Add error to tool history
              toolHistory.push({
                name: toolName,
                args: toolArgs,
                result: `Error: ${error.message}`,
              });

              if (streamCallback) {
                streamCallback({
                  type: "error",
                  content: errorMessage,
                });
              }

              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error: ${error.message}`,
              });
            }
          }

          continue;
        } else {
          finalContent.push(currentMessage.content);
          break;
        }
      }

      // Check if we hit the tool call limit
      if (round >= maxRounds) {
        hitLimit = true;
        const limitMessage = `⚠️ Reached maximum tool calls (${maxRounds}), response may be incomplete`;
        finalContent.push(limitMessage);

        if (streamCallback) {
          streamCallback({
            type: "warning",
            content: limitMessage,
          });
        }
      }

      // Signal end of stream
      if (streamCallback) {
        streamCallback({
          type: "end",
        });
      }

      return {
        content: accumulatedContent,
        usage: lastResponse ? lastResponse.usage : null,
        toolHistory: toolHistory, // Include tool history in response
      };
    };

    // Google Gemini API call with streaming support
    node.callGoogleWithToolsStream = async function (
      messages,
      tools,
      streamCallback
    ) {
      if (!node.googleClient) {
        throw new Error("Google client not initialized");
      }

      // Helper function to check if stream is truly complete
      const isStreamComplete = (
        chunk,
        hasAccumulatedContent,
        hasFunctionCalls
      ) => {
        if (!chunk.candidates || !chunk.candidates[0]) return false;

        const finishReason = chunk.candidates[0].finishReason;
        const hasFinishReason =
          finishReason === "STOP" ||
          finishReason === "MAX_TOKENS" ||
          finishReason === "SAFETY";

        if (!hasFinishReason) return false;

        // Do not treat thoughts-only (no visible content) as completion. Require content or function calls.
        return hasFinishReason && (hasAccumulatedContent || hasFunctionCalls);
      };

      const systemInstruction = messages.find((m) => m.role === "system");
      let conversationMessages = messages.filter((m) => m.role !== "system");
      let accumulatedContent = "";
      let toolHistory = []; // Track tool call history for Google stream
      let lastResponse = null; // Ensure defined for usage field in returns

      // Truncate conversation history if needed before converting to Google format
      const truncatedMessages = node.truncateHistoryIfNeeded(
        conversationMessages,
        100000
      );

      // Convert messages to Google format (with truncated history)
      const contents = node.convertToGoogleFormat(
        truncatedMessages,
        "Google Stream"
      );

      // Check final context size after truncation
      const totalMessages = contents.length;
      const totalChars = JSON.stringify(contents).length;

      if (conversationMessages.length !== truncatedMessages.length) {
        console.log(
          `✂️ [Context-Management] Context was truncated: ${conversationMessages.length} → ${truncatedMessages.length} messages`
        );
      }

      if (totalChars > 100000) {
        console.log(
          `⚠️ [Context-Management] Context is still long after truncation (${totalChars} chars)`
        );
      }

      // If no tools, use simple streaming call
      if (!tools || tools.length === 0) {
        try {
          const request = {
            model: node.model,
            contents: contents,
            config: {
              temperature: node.temperature || 0.1,
              maxOutputTokens: node.maxTokens || 2000,
              systemInstruction: systemInstruction
                ? systemInstruction.content
                : undefined,
            },
          };

          const streamingResponse =
            await node.googleClient.models.generateContentStream(request);

          let finalResponse = null;
          let currentText = ""; // Initialize missing variable
          let functionCalls = []; // Initialize missing variable
          let streamComplete = false; // Initialize missing variable

          for await (const chunk of streamingResponse) {
            // Keep track of the final chunk for 2.5 Pro fallback
            if (
              chunk.candidates &&
              chunk.candidates[0] &&
              chunk.candidates[0].finishReason
            ) {
              finalResponse = chunk;
            }
            // (Debug logging removed for production)

            // 统一内容提取 - 适配所有Gemini模型
            let chunkText = "";
            if (chunk.candidates && chunk.candidates[0]) {
              const candidate = chunk.candidates[0];

              // Method 1: Extract from content.parts (Flash and 2.5 Pro with content)
              if (candidate.content && candidate.content.parts) {
                const textParts = candidate.content.parts
                  .filter((part) => part.text)
                  .map((part) => part.text);
                chunkText = textParts.join("");

                // Debug: Check if there are thoughtSignature parts too
                const thoughtParts = candidate.content.parts.filter(
                  (part) => part.thoughtSignature
                );
                if (thoughtParts.length > 0) {
                }
              }

              // Method 2: Check for direct text in chunk (some models)
              if (!chunkText && chunk.text) {
                chunkText = chunk.text;
              }

              // Method 3: Handle 2.5 Pro case - content without parts but with thoughtsTokenCount
              if (!chunkText && candidate.content && !candidate.content.parts) {
                if (
                  chunk.usageMetadata &&
                  chunk.usageMetadata.thoughtsTokenCount > 0
                ) {
                }
              }

              if (!chunkText) {
              }
            }

            // Handle text content
            if (chunkText) {
              currentText += chunkText;
              accumulatedContent += chunkText;

              if (streamCallback) {
                streamCallback({
                  type: "content",
                  content: chunkText,
                });
              }
            }

            // Check for function calls
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
              functionCalls = chunk.functionCalls;
            } else if (
              chunk.candidates &&
              chunk.candidates[0] &&
              chunk.candidates[0].content
            ) {
              // Check for function calls in the content parts
              const content = chunk.candidates[0].content;
              if (content.parts) {
                for (const part of content.parts) {
                  if (part.functionCall) {
                    functionCalls.push(part.functionCall);
                  }
                }
              }
            }

            // Check if stream is truly complete
            if (
              isStreamComplete(
                chunk,
                accumulatedContent.length > 0,
                functionCalls.length > 0
              )
            ) {
              streamComplete = true;
              const finishReason =
                chunk.candidates && chunk.candidates[0]
                  ? chunk.candidates[0].finishReason
                  : "unknown";
              break;
            }
          }

          // Fallback for reasoning models: if stream ended with no content and no function calls, try non-stream once
          if (currentText.length === 0 && functionCalls.length === 0) {
            try {
              const nonStreamResponse =
                await node.googleClient.models.generateContent({
                  model: node.model,
                  contents: contents,
                  config: {
                    tools: [{ functionDeclarations: functionDeclarations }],
                    temperature: node.temperature || 0.1,
                    maxOutputTokens: node.maxTokens || 2000,
                    systemInstruction: systemInstruction
                      ? systemInstruction.content
                      : undefined,
                  },
                });

              // Extract text from non-stream response
              let fallbackText = nonStreamResponse.text || "";
              if (
                !fallbackText &&
                nonStreamResponse.candidates &&
                nonStreamResponse.candidates[0]
              ) {
                const candidate = nonStreamResponse.candidates[0];
                if (candidate.content && candidate.content.parts) {
                  fallbackText = candidate.content.parts
                    .filter((part) => part.text)
                    .map((part) => part.text)
                    .join("");
                }
              }

              // Extract function calls if any
              let fallbackCalls = [];
              if (
                nonStreamResponse.functionCalls &&
                nonStreamResponse.functionCalls.length > 0
              ) {
                fallbackCalls = nonStreamResponse.functionCalls;
              } else if (
                nonStreamResponse.candidates &&
                nonStreamResponse.candidates[0] &&
                nonStreamResponse.candidates[0].content &&
                nonStreamResponse.candidates[0].content.parts
              ) {
                for (const part of nonStreamResponse.candidates[0].content
                  .parts) {
                  if (part.functionCall) {
                    fallbackCalls.push(part.functionCall);
                  }
                }
              }

              if (fallbackText) {
                currentText = fallbackText;
                accumulatedContent += fallbackText;
                if (streamCallback) {
                  streamCallback({ type: "content", content: fallbackText });
                }
              }

              if (fallbackCalls.length > 0) {
                functionCalls = fallbackCalls;
              }
            } catch (e) {}
          }

          // Fallback for Gemini 2.5 Pro: if we got no content, try non-streaming API
          if (accumulatedContent.length === 0) {
            try {
              const nonStreamResponse =
                await node.googleClient.models.generateContent({
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

              // Robust extraction from non-stream response
              let fallbackText = nonStreamResponse.text || "";
              if (
                !fallbackText &&
                nonStreamResponse.candidates &&
                nonStreamResponse.candidates[0] &&
                nonStreamResponse.candidates[0].content &&
                nonStreamResponse.candidates[0].content.parts
              ) {
                fallbackText = nonStreamResponse.candidates[0].content.parts
                  .filter((part) => part.text)
                  .map((part) => part.text)
                  .join("");
              }

              if (fallbackText) {
                accumulatedContent = fallbackText;
                if (streamCallback) {
                  streamCallback({ type: "content", content: fallbackText });
                }
              }
            } catch (error) {}
          }

          // Ensure at least some content is emitted before ending
          if (accumulatedContent.length === 0 && streamCallback) {
            streamCallback({
              type: "content",
              content: "No response generated",
            });
          }

          if (streamCallback) {
            streamCallback({
              type: "end",
            });
          }

          return {
            content: accumulatedContent,
            usage: finalResponse ? finalResponse.usageMetadata : null,
            toolHistory: toolHistory, // Include tool history for Google stream
          };
        } catch (error) {
          throw new Error(`Google API streaming call failed: ${error.message}`);
        }
      }

      // Convert tools to Google format (functionDeclarations) for tool-enabled streaming
      const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      }));

      // Execute up to configured rounds of tool calls to prevent infinite loops
      const maxRounds = node.toolCallLimit || 10;

      let round = 0;
      let hitLimit = false;

      for (round = 0; round < maxRounds; round++) {
        try {
          // Use the latest Gen AI SDK config format for streaming with tools
          const config = {
            tools: [{ functionDeclarations: functionDeclarations }],
            temperature: node.temperature || 0.1,
            maxOutputTokens: node.maxTokens || 2000,
            systemInstruction: systemInstruction
              ? systemInstruction.content
              : undefined,
          };

          const streamingResponse =
            await node.googleClient.models.generateContentStream({
              model: node.model,
              contents: contents,
              config: config,
            });

          lastResponse = null;
          let currentStreamText = "";
          let streamFunctionCalls = [];
          let streamComplete = false;

          for await (const chunk of streamingResponse) {
            // Keep track of the final chunk
            if (
              chunk.candidates &&
              chunk.candidates[0] &&
              chunk.candidates[0].finishReason
            ) {
              lastResponse = chunk;
            }

            // Extract text content
            let chunkText = "";
            if (chunk.candidates && chunk.candidates[0]) {
              const candidate = chunk.candidates[0];

              if (candidate.content && candidate.content.parts) {
                const textParts = candidate.content.parts
                  .filter((part) => part.text)
                  .map((part) => part.text);
                chunkText = textParts.join("");
              }

              if (!chunkText && chunk.text) {
                chunkText = chunk.text;
              }
            }

            // Handle text content
            if (chunkText) {
              currentStreamText += chunkText;
              accumulatedContent += chunkText;

              if (streamCallback) {
                streamCallback({
                  type: "content",
                  content: chunkText,
                });
              }
            }

            // Check for function calls in stream
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
              streamFunctionCalls = chunk.functionCalls;
            } else if (
              chunk.candidates &&
              chunk.candidates[0] &&
              chunk.candidates[0].content &&
              chunk.candidates[0].content.parts
            ) {
              for (const part of chunk.candidates[0].content.parts) {
                if (part.functionCall) {
                  streamFunctionCalls.push(part.functionCall);
                }
              }
            }

            // Check if stream is complete
            if (
              isStreamComplete(
                chunk,
                currentStreamText.length > 0,
                streamFunctionCalls.length > 0
              )
            ) {
              streamComplete = true;
              break;
            }
          }

          if (streamFunctionCalls && streamFunctionCalls.length > 0) {
            // Has tool calls - add model response to conversation
            const modelContent = {
              role: "model",
              parts: [],
            };

            // Add text response if available
            if (currentStreamText) {
              modelContent.parts.push({ text: currentStreamText });
            }

            // Add function calls
            for (const functionCall of streamFunctionCalls) {
              modelContent.parts.push({ functionCall: functionCall });
            }

            contents.push(modelContent);

            const functionResponses = [];

            for (const functionCall of streamFunctionCalls) {
              const toolName = functionCall.name;
              const toolArgs =
                functionCall.args || functionCall.arguments || {};

              const toolMessage = `🔧 Calling tool: ${toolName}`;

              // Console output: Tool call (Google Stream)
              console.log(
                `🔧 [Dev-Copilot] Tool Call (Google Stream): ${toolName}`,
                toolArgs
              );

              if (streamCallback) {
                streamCallback({
                  type: "tool",
                  content: toolMessage,
                });
              }

              try {
                const toolResult = await node.executeMCPTool(
                  toolName,
                  toolArgs
                );
                const formattedResult = node.formatToolResult(toolResult);

                // Console output: Tool result (Google Stream)
                console.log(
                  `✅ [Dev-Copilot] Tool Result (Google Stream): ${toolName}`,
                  formattedResult
                );

                // Add to tool history
                toolHistory.push({
                  name: toolName,
                  args: toolArgs,
                  result: formattedResult,
                });

                functionResponses.push({
                  functionResponse: {
                    name: toolName,
                    response: {
                      result: formattedResult,
                    },
                  },
                });
              } catch (error) {
                // Console output: Tool error (Google Stream)
                console.log(
                  `❌ [Dev-Copilot] Tool Error (Google Stream): ${toolName}`,
                  error.message
                );

                const errorMessage = `❌ Tool call failed: ${error.message}`;

                // Add error to tool history
                toolHistory.push({
                  name: toolName,
                  args: toolArgs,
                  result: `Error: ${error.message}`,
                });

                if (streamCallback) {
                  streamCallback({
                    type: "error",
                    content: errorMessage,
                  });
                }

                functionResponses.push({
                  functionResponse: {
                    name: toolName,
                    response: {
                      error: error.message,
                    },
                  },
                });
              }
            }

            // Add tool results to conversation
            contents.push({
              role: "user",
              parts: functionResponses,
            });

            continue; // Continue to next round of tool calls
          } else {
            // No tool calls, check if we have text response
            if (currentStreamText.length > 0) {
              break; // We have text response, exit loop
            }
            // If no text and no tools, continue waiting for response
            continue;
          }
        } catch (error) {
          throw new Error(
            `Google API streaming with tools failed: ${error.message}`
          );
        }
      }

      // Check if we hit the tool call limit
      if (typeof round === "number" && round >= maxRounds) {
        hitLimit = true;
        const limitMessage = `⚠️ Reached maximum tool calls (${maxRounds}), response may be incomplete`;

        if (streamCallback) {
          streamCallback({
            type: "warning",
            content: limitMessage,
          });
        }
      }

      // Signal end of stream
      if (streamCallback) {
        streamCallback({
          type: "end",
        });
      }

      // Debug summary removed

      return {
        content: accumulatedContent,
        usage: lastResponse ? lastResponse.usageMetadata || null : null,
        toolHistory: toolHistory, // Include tool history for Google stream
      };
    };

    // Process input messages
    node.on("input", async function (msg) {
      // Service Only for sidebar chat
      if (node.mode === "service") {
        node.warn(
          "Service mode nodes are only for sidebar chat. Use Flow mode for message processing."
        );
        return;
      }

      try {
        node.status({ fill: "blue", shape: "dot", text: "processing" });

        // Build message history for Flow mode
        const messages = [
          {
            role: "system",
            content: node.systemPrompt || "You are a helpful assistant",
          },
        ];

        // For Flow mode, load existing conversation history from storage
        let conversationHistory = node.getHistory();

        // If there are historical messages in the input, append them to existing history
        if (msg.history && Array.isArray(msg.history)) {
          conversationHistory.push(...msg.history);
        }

        // Add current user message to conversation history first
        const userMessage = {
          role: "user",
          content:
            typeof msg.payload === "string"
              ? msg.payload
              : JSON.stringify(msg.payload),
        };

        if (msg.payload) {
          // Console output: Flow mode input
          console.log("🟦 [Dev-Copilot] Flow Input:", userMessage.content);

          // Add user message to conversation history
          conversationHistory.push(userMessage);
        }

        // Add complete conversation history (including current user message) to messages
        if (conversationHistory.length > 0) {
          messages.splice(1, 0, ...conversationHistory);
        }

        // Call LLM
        console.log("🔄 [Dev-Copilot] Calling LLM (Flow)...");
        const response = await node.callLLM(messages);

        // Console output: Flow response
        console.log(
          "🟩 [Dev-Copilot] Flow Response:",
          response.content || "No content"
        );

        // Add assistant response to conversation history and save it
        if (response && response.content) {
          const assistantMessage = {
            role: "assistant",
            content: response.content,
          };

          // Add tool history if available
          if (response.toolHistory && response.toolHistory.length > 0) {
            assistantMessage._toolHistory = response.toolHistory;
          }

          conversationHistory.push(assistantMessage);

          // Save updated conversation history to Flow node's independent storage
          node.saveHistory(conversationHistory);
        }

        // Prepare output message
        const outputMsg = {
          ...msg,
          payload: response.content,
          history: conversationHistory, // Include updated history in output
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
    node.on("close", async function (removed, done) {
      await node.disconnectMCP();

      // Only clean up history when node is actually removed (not on flow restart)
      if (removed && node.mode === "flow") {
        const historyKey = `dev-copilot-flow-history-${node.id}`;
        node.context().global.set(historyKey, null);
      }

      if (done) done();
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

  // Inject API prefix configuration into client-side via custom endpoint
  RED.httpAdmin.get("/dev-copilot-config.js", function (req, res) {
    const effectivePrefix = `${req.baseUrl || ""}${API_PREFIX}`;
    const configScript = `
      // API prefix configuration injected by backend
      window.NODE_HTTP_API_PREFIX = '${effectivePrefix}';
      console.log('Dev Copilot: API prefix configured via script injection:', window.NODE_HTTP_API_PREFIX);
    `;

    res.setHeader("Content-Type", "application/javascript");
    res.send(configScript);
  });

  // Register sidebar
  RED.httpAdmin.get(`${API_PREFIX}/sidebar`, function (req, res) {
    const fs = require("fs");
    const sidebarPath = path.join(__dirname, "../public/sidebar.html");

    // Check if file exists
    if (fs.existsSync(sidebarPath)) {
      // Read HTML template
      let htmlContent = fs.readFileSync(sidebarPath, "utf8");

      // Inject API prefix variable including admin base
      const effectivePrefix = `${req.baseUrl || ""}${API_PREFIX}`;
      htmlContent = htmlContent.replace("{{API_PREFIX}}", effectivePrefix);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } else {
      RED.log.error("Dev Copilot sidebar file not found: " + sidebarPath);
      res.status(404).send("Sidebar file not found");
    }
  });

  // API endpoint: send message to copilot
  RED.httpAdmin.post(`${API_PREFIX}/chat`, async function (req, res) {
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

      // Load current Service mode history
      let serviceHistory = node.getHistory();

      // Build messages for LLM call
      const messages = [
        {
          role: "system",
          content: node.systemPrompt || node.defaultSystemPrompt,
        },
      ];

      // Use the current service history
      if (serviceHistory && serviceHistory.length > 0) {
        messages.push(...serviceHistory);
      }

      // Add current user message
      const userMessage = {
        role: "user",
        content: message,
      };
      messages.push(userMessage);

      // Console output: User input
      console.log("🟦 [Dev-Copilot] User Input:", message);

      // Call LLM
      console.log("🔄 [Dev-Copilot] Calling LLM...");
      const response = await node.callLLM(messages);

      // Console output: LLM response
      console.log(
        "🟩 [Dev-Copilot] LLM Response:",
        response.content || "No content"
      );

      // Add both user and assistant messages to service history
      serviceHistory.push(userMessage);
      if (response && response.content) {
        const assistantMessage = {
          role: "assistant",
          content: response.content,
        };

        // Add tool history if available
        if (response.toolHistory && response.toolHistory.length > 0) {
          assistantMessage._toolHistory = response.toolHistory;
        }

        serviceHistory.push(assistantMessage);
      }

      // Save updated history to service storage
      node.saveHistory(serviceHistory);

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

  // API endpoint: send message to copilot with streaming
  RED.httpAdmin.post(`${API_PREFIX}/chat-stream`, async function (req, res) {
    try {
      const { message, nodeId, history } = req.body;

      // Set headers for Server-Sent Events
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
      });

      // Helper function to send SSE data
      const sendSSE = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // If no nodeId provided, try to find available node
      let node;
      if (nodeId) {
        node = RED.nodes.getNode(nodeId);

        if (!node) {
          sendSSE({
            type: "error",
            content: `Selected node (ID: ${nodeId}) not found. Please reselect node and try again.`,
          });
          res.end();
          return;
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
          sendSSE({
            type: "error",
            content:
              "No available Dev Copilot nodes found. Please create and deploy a node first.",
          });
          res.end();
          return;
        }
        node = foundNode;
      }

      // Check node configuration
      if (!node.apiKey) {
        sendSSE({
          type: "error",
          content: `Node configuration incomplete: missing ${node.provider} API key. Please configure the node.`,
        });
        res.end();
        return;
      }

      // Load current Service mode history
      let serviceHistory = node.getHistory();

      // Build messages for LLM call
      const messages = [
        {
          role: "system",
          content: node.systemPrompt || node.defaultSystemPrompt,
        },
      ];

      // Use the current service history
      if (serviceHistory && serviceHistory.length > 0) {
        messages.push(...serviceHistory);
      }

      // Add current user message
      const userMessage = {
        role: "user",
        content: message,
      };
      messages.push(userMessage);

      // Console output: User input (Stream)
      console.log("🟦 [Dev-Copilot] User Input (Stream):", message);

      // Send initial status
      sendSSE({
        type: "start",
        content: "Starting response...",
      });

      // Store the complete response for history
      let completeResponse = "";
      let streamToolHistory = [];

      // Console output: Starting stream
      console.log("🔄 [Dev-Copilot] Calling LLM (Stream)...");

      // Call LLM with streaming
      const streamResult = await node.callLLMStream(messages, (chunk) => {
        if (chunk.type === "content" && chunk.content) {
          completeResponse += chunk.content;
        }
        sendSSE(chunk);
      });

      // Get tool history from stream result
      if (streamResult && streamResult.toolHistory) {
        streamToolHistory = streamResult.toolHistory;
      }

      // Console output: Stream response completed
      console.log(
        "🟩 [Dev-Copilot] Stream Response Completed:",
        completeResponse
      );

      // Add user and assistant messages to service history and save
      serviceHistory.push(userMessage);
      if (completeResponse) {
        const assistantMessage = {
          role: "assistant",
          content: completeResponse,
        };

        // Add tool history if available
        if (streamToolHistory.length > 0) {
          assistantMessage._toolHistory = streamToolHistory;
        }

        serviceHistory.push(assistantMessage);
        node.saveHistory(serviceHistory);
      }

      // Close connection
      res.end();
    } catch (error) {
      try {
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            content: `Stream error: ${error.message}`,
          })}\n\n`
        );
        res.end();
      } catch (writeError) {
        // Connection might be closed
        console.error("Error writing to stream:", writeError);
      }
    }
  });

  // API endpoint: get available dev-copilot nodes
  RED.httpAdmin.get(`${API_PREFIX}/nodes`, function (req, res) {
    const nodes = [];

    // Get runtime node instances
    RED.nodes.eachNode(function (configNode) {
      if (configNode.type === "dev-copilot") {
        // 只返回Service模式的节点
        const mode = configNode.mode || "service"; // 默认service模式
        if (mode !== "service") {
          return; // 跳过非Service模式的节点
        }

        // Find corresponding runtime node instance
        const runtimeNode = RED.nodes.getNode(configNode.id);
        if (runtimeNode) {
          nodes.push({
            id: runtimeNode.id,
            name: runtimeNode.name || configNode.name || "Dev Copilot",
            provider: runtimeNode.provider || configNode.provider,
            model: runtimeNode.model || configNode.model,
            mode: runtimeNode.mode || configNode.mode || "service",
            status: "deployed", // Has runtime instance means deployed
          });
        } else {
          // Configuration exists but not deployed
          nodes.push({
            id: configNode.id,
            name: configNode.name || "Dev Copilot",
            provider: configNode.provider,
            model: configNode.model,
            mode: configNode.mode || "service",
            status: "not_deployed", // Not deployed
          });
        }
      }
    });

    res.json(nodes);
  });

  // 注意：节点选择记录现在直接使用context storage API，不需要专门的端点

  // API endpoint: get context data
  RED.httpAdmin.post(`${API_PREFIX}/context/get`, function (req, res) {
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
  RED.httpAdmin.post(`${API_PREFIX}/context/set`, function (req, res) {
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

  // Fixed configuration endpoint (always at /dev-copilot-config)
  RED.httpAdmin.get("/dev-copilot-config", function (req, res) {
    const effectivePrefix = `${req.baseUrl || ""}${API_PREFIX}`;
    res.json({
      apiPrefix: effectivePrefix,
      version: require("../package.json").version,
    });
  });

  // API endpoint: get configuration (including API prefix) - dynamic path
  RED.httpAdmin.get(`${API_PREFIX}/config`, function (req, res) {
    const effectivePrefix = `${req.baseUrl || ""}${API_PREFIX}`;
    res.json({
      apiPrefix: effectivePrefix,
      version: require("../package.json").version,
    });
  });

  // API endpoint: delete context data
  RED.httpAdmin.post(`${API_PREFIX}/context/delete`, function (req, res) {
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
