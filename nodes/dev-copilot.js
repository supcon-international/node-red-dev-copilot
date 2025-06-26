const { spawn } = require("child_process");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const axios = require("axios");
const path = require("path");
const MCPClientHelper = require(path.join(
  __dirname,
  "..",
  "mcp",
  "mcp-client.js"
));

module.exports = function (RED) {
  "use strict";

  function DevCopilotNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // 获取配置属性
    node.provider = config.provider || "openai";
    node.model = config.model || "gpt-4";
    node.mcpCommand = config.mcpCommand || "";
    node.mcpArgs = config.mcpArgs || "";
    node.mcpEnv = config.mcpEnv || "";
    node.systemPrompt =
      config.systemPrompt || "You are a helpful development assistant.";

    // Azure OpenAI 特定配置
    node.azureEndpoint = config.azureEndpoint || "";
    node.azureApiVersion = config.azureApiVersion || "2024-02-15-preview";

    // 获取敏感信息（credentials）
    node.apiKey = node.credentials.apiKey || "";

    // MCP 客户端实例 - 使用新的 MCPClientHelper
    node.mcpClient = new MCPClientHelper();

    // 系统提示词（预设）
    node.defaultSystemPrompt = `You are a development assistant integrated into Node-RED. 
You can help with:
- Node-RED flow development
- JavaScript/Node.js code analysis
- Debugging assistance
- Best practices recommendations
- Documentation generation

Please provide clear, actionable advice and code examples when appropriate.`;

    // 初始化 MCP 连接 - 简化配置
    node.initMCP = async function () {
      if (!node.mcpCommand) {
        node.warn("MCP 命令未配置");
        node.status({
          fill: "yellow",
          shape: "ring",
          text: "no MCP configured",
        });
        return false;
      }

      try {
        // 解析参数
        const args = node.mcpArgs
          ? node.mcpArgs.split(" ").filter((arg) => arg.trim())
          : [];

        // 解析环境变量
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

        node.log(`🔌 初始化 MCP 连接:`);
        node.log(`   命令: ${node.mcpCommand}`);
        if (args.length > 0) {
          node.log(`   参数: ${args.join(" ")}`);
        }
        if (Object.keys(env).length > 0) {
          node.log(`   环境变量: ${JSON.stringify(env)}`);
        }

        // 连接到 MCP 服务器
        const success = await node.mcpClient.connect(
          node.mcpCommand,
          args,
          env
        );

        if (success) {
          // 获取服务器信息
          const serverInfo = await node.mcpClient.getServerInfo();

          node.log(`✅ MCP 服务器连接成功`);
          node.log(`   工具数量: ${serverInfo.tools.length}`);
          node.log(`   资源数量: ${serverInfo.resources.length}`);

          node.status({
            fill: "green",
            shape: "dot",
            text: `MCP: ${serverInfo.tools.length} tools`,
          });

          return true;
        } else {
          throw new Error("连接失败");
        }
      } catch (error) {
        node.error(`❌ MCP 服务器连接失败: ${error.message}`);
        node.status({
          fill: "red",
          shape: "ring",
          text: "MCP connection failed",
        });
        return false;
      }
    };

    // 断开 MCP 连接
    node.disconnectMCP = async function () {
      if (node.mcpClient && node.mcpClient.isClientConnected()) {
        try {
          await node.mcpClient.cleanup();
          node.log("🔌 MCP 服务器连接已断开");
          node.status({ fill: "grey", shape: "ring", text: "disconnected" });
        } catch (error) {
          node.error("断开 MCP 服务器连接时出错: " + error.message);
        }
      }
    };

    // 获取MCP工具列表 - 使用新的客户端助手
    node.getMCPTools = async function () {
      const tools = [];

      if (node.mcpClient && node.mcpClient.isClientConnected()) {
        try {
          const mcpTools = await node.mcpClient.listTools();

          // 转换MCP工具格式为LLM API工具格式
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
            `🔧 发现 ${tools.length} 个MCP工具: ${mcpTools
              .map((t) => t.name)
              .join(", ")}`
          );
        } catch (error) {
          node.warn("获取MCP工具列表失败: " + error.message);
        }
      }

      return tools;
    };

    // 执行MCP工具调用 - 使用新的客户端助手
    node.executeMCPTool = async function (toolName, toolArgs) {
      if (!node.mcpClient || !node.mcpClient.isClientConnected()) {
        throw new Error("MCP 客户端未连接");
      }

      try {
        const result = await node.mcpClient.callTool(toolName, toolArgs);
        return result;
      } catch (error) {
        node.error(`MCP 工具调用失败 ${toolName}: ${error.message}`);
        throw error;
      }
    };

    // 格式化工具结果 - 确保符合 LLM API 要求
    node.formatToolResult = function (toolResult) {
      let resultContent;

      try {
        if (toolResult && toolResult.content) {
          if (Array.isArray(toolResult.content)) {
            // 如果是数组，提取文本内容
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

        // 限制结果长度，避免请求体过大
        if (resultContent.length > 4000) {
          resultContent =
            resultContent.substring(0, 4000) +
            "\n\n... [结果已截断，共" +
            resultContent.length +
            "字符]";
        }

        return resultContent;
      } catch (error) {
        return `Error formatting result: ${error.message}`;
      }
    };

    // 调用 LLM API（集成MCP工具）
    node.callLLM = async function (messages) {
      if (!node.apiKey) {
        throw new Error(
          `API密钥未配置，请在节点配置中设置${node.provider}的API密钥`
        );
      }

      try {
        // 获取可用的MCP工具
        const availableTools = await node.getMCPTools();

        switch (node.provider.toLowerCase()) {
          case "openai":
            return await node.callOpenAIWithTools(messages, availableTools);
          case "anthropic":
            return await node.callAnthropicWithTools(messages, availableTools);
          case "google":
            return await node.callGoogleWithTools(messages, availableTools);
          case "azure":
            return await node.callAzureOpenAIWithTools(
              messages,
              availableTools
            );
          default:
            throw new Error(`不支持的LLM提供商: ${node.provider}`);
        }
      } catch (error) {
        node.error(`LLM API调用失败 (${node.provider}): ${error.message}`);
        // 如果API调用失败，返回错误信息而不是崩溃
        return {
          content: `❌ LLM API调用失败 (${node.provider}): ${error.message}\n\n请检查：\n1. API密钥是否正确\n2. 网络连接是否正常\n3. 模型名称是否有效\n4. API配额是否充足`,
          error: true,
        };
      }
    };

    // OpenAI API 调用（带工具集成）
    node.callOpenAIWithTools = async function (messages, tools) {
      let conversationMessages = [...messages];
      let finalContent = [];
      let lastResponse = null; // 保存最后一次API响应

      // 最多执行5轮工具调用，防止无限循环
      for (let round = 0; round < 5; round++) {
        const requestBody = {
          model: node.model,
          messages: conversationMessages,
          temperature: 0.7,
          max_tokens: 2000,
        };

        // 如果有可用工具，添加到请求中
        if (tools && tools.length > 0) {
          requestBody.tools = tools;
          requestBody.tool_choice = "auto";
        }

        const response = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          requestBody,
          {
            headers: {
              Authorization: `Bearer ${node.apiKey}`,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );

        lastResponse = response; // 保存响应用于最终返回
        const message = response.data.choices[0].message;
        conversationMessages.push(message);

        // 检查是否有工具调用
        if (message.tool_calls && message.tool_calls.length > 0) {
          // 执行工具调用
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            finalContent.push(`🔧 调用工具: ${toolName}`);
            finalContent.push(`📝 参数: ${JSON.stringify(toolArgs, null, 2)}`);

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);

              // 格式化工具结果
              const formattedResult = node.formatToolResult(toolResult);

              // 添加工具调用结果到对话
              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: formattedResult,
              });

              // 为显示目的截断结果
              const displayResult =
                formattedResult.length > 500
                  ? formattedResult.substring(0, 500) + "...[已截断]"
                  : formattedResult;

              finalContent.push(`✅ 工具结果: ${displayResult}`);
            } catch (error) {
              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error: ${error.message}`,
              });

              finalContent.push(`❌ 工具调用失败: ${error.message}`);
            }
          }

          // 继续对话，让LLM处理工具结果
          continue;
        } else {
          // 没有工具调用，返回最终响应
          finalContent.push(message.content);
          break;
        }
      }

      return {
        content: finalContent.join("\n\n"),
        usage: lastResponse ? lastResponse.data.usage : null,
      };
    };

    // Anthropic API 调用（带工具集成）
    node.callAnthropicWithTools = async function (messages, tools) {
      // 将OpenAI格式转换为Anthropic格式
      const systemMessage = messages.find((m) => m.role === "system");
      let conversationMessages = messages.filter((m) => m.role !== "system");
      let finalContent = [];
      let lastResponse = null; // 保存最后一次API响应

      // 转换工具格式为Anthropic格式
      const anthropicTools = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));

      // 最多执行5轮工具调用，防止无限循环
      for (let round = 0; round < 5; round++) {
        const requestBody = {
          model: node.model,
          system: systemMessage ? systemMessage.content : undefined,
          messages: conversationMessages,
          max_tokens: 2000,
        };

        // 如果有可用工具，添加到请求中
        if (anthropicTools && anthropicTools.length > 0) {
          requestBody.tools = anthropicTools;
        }

        const response = await axios.post(
          "https://api.anthropic.com/v1/messages",
          requestBody,
          {
            headers: {
              "x-api-key": node.apiKey,
              "Content-Type": "application/json",
              "anthropic-version": "2023-06-01",
            },
            timeout: 30000,
          }
        );

        lastResponse = response; // 保存响应用于最终返回
        const responseContent = response.data.content;

        // 检查响应中是否有工具调用
        const toolUses = responseContent.filter(
          (content) => content.type === "tool_use"
        );
        const textContent = responseContent.filter(
          (content) => content.type === "text"
        );

        // 添加文本内容
        if (textContent.length > 0) {
          finalContent.push(textContent.map((t) => t.text).join("\n"));
        }

        if (toolUses.length > 0) {
          // 添加助手消息到对话历史
          conversationMessages.push({
            role: "assistant",
            content: responseContent,
          });

          const toolResults = [];

          // 执行工具调用
          for (const toolUse of toolUses) {
            const toolName = toolUse.name;
            const toolArgs = toolUse.input;

            finalContent.push(`🔧 调用工具: ${toolName}`);
            finalContent.push(`📝 参数: ${JSON.stringify(toolArgs, null, 2)}`);

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);

              // 格式化工具结果
              const formattedResult = node.formatToolResult(toolResult);

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: formattedResult,
              });

              // 为显示目的截断结果
              const displayResult =
                formattedResult.length > 500
                  ? formattedResult.substring(0, 500) + "...[已截断]"
                  : formattedResult;

              finalContent.push(`✅ 工具结果: ${displayResult}`);
            } catch (error) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Error: ${error.message}`,
              });

              finalContent.push(`❌ 工具调用失败: ${error.message}`);
            }
          }

          // 添加工具结果到对话
          conversationMessages.push({
            role: "user",
            content: toolResults,
          });

          // 继续对话，让Claude处理工具结果
          continue;
        } else {
          // 没有工具调用，返回最终响应
          break;
        }
      }

      return {
        content: finalContent.join("\n\n"),
        usage: lastResponse ? lastResponse.data.usage : null,
      };
    };

    // Google Gemini API 调用（带工具集成）
    node.callGoogleWithTools = async function (messages, tools) {
      const systemInstruction = messages.find((m) => m.role === "system");
      let conversationMessages = messages.filter((m) => m.role !== "system");
      let finalContent = [];
      let lastResponse = null; // 保存最后一次API响应

      // 转换工具格式为Google格式
      const googleTools =
        tools.length > 0
          ? [
              {
                function_declarations: tools.map((tool) => ({
                  name: tool.function.name,
                  description: tool.function.description,
                  parameters: tool.function.parameters,
                })),
              },
            ]
          : [];

      // 最多执行5轮工具调用，防止无限循环
      for (let round = 0; round < 5; round++) {
        // 将消息格式转换为Gemini格式
        const contents = conversationMessages.map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        }));

        const requestBody = {
          contents: contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000,
          },
        };

        if (systemInstruction) {
          requestBody.systemInstruction = {
            parts: [{ text: systemInstruction.content }],
          };
        }

        // 如果有可用工具，添加到请求中
        if (googleTools.length > 0) {
          requestBody.tools = googleTools;
        }

        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${node.model}:generateContent?key=${node.apiKey}`,
          requestBody,
          {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );

        lastResponse = response; // 保存响应用于最终返回
        const candidate = response.data.candidates[0];
        const parts = candidate.content.parts;

        // 检查是否有函数调用
        const functionCalls = parts.filter((part) => part.functionCall);
        const textParts = parts.filter((part) => part.text);

        // 添加文本内容
        if (textParts.length > 0) {
          finalContent.push(textParts.map((p) => p.text).join("\n"));
        }

        if (functionCalls.length > 0) {
          // 添加模型响应到对话历史
          conversationMessages.push({
            role: "assistant",
            content: parts
              .map((p) => p.text || `[Function Call: ${p.functionCall?.name}]`)
              .join("\n"),
          });

          // 执行函数调用
          for (const functionCall of functionCalls) {
            const toolName = functionCall.functionCall.name;
            const toolArgs = functionCall.functionCall.args;

            finalContent.push(`🔧 调用工具: ${toolName}`);
            finalContent.push(`📝 参数: ${JSON.stringify(toolArgs, null, 2)}`);

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);

              // 格式化工具结果
              const formattedResult = node.formatToolResult(toolResult);

              // 添加函数调用结果到对话（Google格式）
              conversationMessages.push({
                role: "user",
                content: `Function ${toolName} result: ${formattedResult}`,
              });

              // 为显示目的截断结果
              const displayResult =
                formattedResult.length > 500
                  ? formattedResult.substring(0, 500) + "...[已截断]"
                  : formattedResult;

              finalContent.push(`✅ 工具结果: ${displayResult}`);
            } catch (error) {
              conversationMessages.push({
                role: "user",
                content: `Function ${toolName} error: ${error.message}`,
              });

              finalContent.push(`❌ 工具调用失败: ${error.message}`);
            }
          }

          // 继续对话，让Gemini处理工具结果
          continue;
        } else {
          // 没有工具调用，返回最终响应
          break;
        }
      }

      return {
        content: finalContent.join("\n\n"),
        usage: lastResponse ? lastResponse.data.usageMetadata : null,
      };
    };

    // Azure OpenAI API 调用（带工具集成）
    node.callAzureOpenAIWithTools = async function (messages, tools) {
      // Azure OpenAI需要额外的配置信息
      if (!node.azureEndpoint || !node.azureApiVersion) {
        throw new Error("Azure OpenAI需要配置endpoint和API版本");
      }

      let conversationMessages = [...messages];
      let finalContent = [];
      let lastResponse = null; // 保存最后一次API响应

      // 最多执行5轮工具调用，防止无限循环
      for (let round = 0; round < 5; round++) {
        const requestBody = {
          messages: conversationMessages,
          temperature: 0.7,
          max_tokens: 2000,
        };

        // 如果有可用工具，添加到请求中
        if (tools && tools.length > 0) {
          requestBody.tools = tools;
          requestBody.tool_choice = "auto";
        }

        const response = await axios.post(
          `${node.azureEndpoint}/openai/deployments/${node.model}/chat/completions?api-version=${node.azureApiVersion}`,
          requestBody,
          {
            headers: {
              "api-key": node.apiKey,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );

        lastResponse = response; // 保存响应用于最终返回
        const message = response.data.choices[0].message;
        conversationMessages.push(message);

        // 检查是否有工具调用
        if (message.tool_calls && message.tool_calls.length > 0) {
          // 执行工具调用
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            finalContent.push(`🔧 调用工具: ${toolName}`);
            finalContent.push(`📝 参数: ${JSON.stringify(toolArgs, null, 2)}`);

            try {
              const toolResult = await node.executeMCPTool(toolName, toolArgs);

              // 格式化工具结果
              const formattedResult = node.formatToolResult(toolResult);

              // 添加工具调用结果到对话
              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: formattedResult,
              });

              // 为显示目的截断结果
              const displayResult =
                formattedResult.length > 500
                  ? formattedResult.substring(0, 500) + "...[已截断]"
                  : formattedResult;

              finalContent.push(`✅ 工具结果: ${displayResult}`);
            } catch (error) {
              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error: ${error.message}`,
              });

              finalContent.push(`❌ 工具调用失败: ${error.message}`);
            }
          }

          // 继续对话，让LLM处理工具结果
          continue;
        } else {
          // 没有工具调用，返回最终响应
          finalContent.push(message.content);
          break;
        }
      }

      return {
        content: finalContent.join("\n\n"),
        usage: lastResponse ? lastResponse.data.usage : null,
      };
    };

    // 处理输入消息
    node.on("input", async function (msg) {
      try {
        node.status({ fill: "blue", shape: "dot", text: "processing" });

        // 构建消息历史
        const messages = [
          {
            role: "system",
            content: node.systemPrompt || node.defaultSystemPrompt,
          },
        ];

        // 添加用户消息
        if (msg.payload) {
          messages.push({
            role: "user",
            content:
              typeof msg.payload === "string"
                ? msg.payload
                : JSON.stringify(msg.payload),
          });
        }

        // 如果有历史消息，添加到对话中
        if (msg.history && Array.isArray(msg.history)) {
          messages.splice(1, 0, ...msg.history);
        }

        // 调用 LLM
        const response = await node.callLLM(messages);

        // 准备输出消息
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

        // 如果有 MCP 工具可用，添加工具信息
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

        // 发送错误消息
        const errorMsg = {
          ...msg,
          payload: "Error: " + error.message,
          error: error.message,
        };
        node.send(errorMsg);
      }
    });

    // 节点关闭时清理资源
    node.on("close", async function () {
      await node.disconnectMCP();
    });

    // 初始化时尝试连接 MCP
    if (node.mcpCommand) {
      setImmediate(() => {
        node.initMCP();
      });
    } else {
      // 没有配置MCP（这是正常的）
      node.status({
        fill: "blue",
        shape: "ring",
        text: "ready (no MCP)",
      });
    }
  }

  // 注册节点
  RED.nodes.registerType("dev-copilot", DevCopilotNode, {
    credentials: {
      apiKey: { type: "password" },
    },
  });

  // 注册侧边栏
  RED.httpAdmin.get("/dev-copilot/sidebar", function (req, res) {
    const path = require("path");
    const sidebarPath = path.join(__dirname, "..", "public", "sidebar.html");

    // 检查文件是否存在
    const fs = require("fs");
    if (fs.existsSync(sidebarPath)) {
      res.sendFile(sidebarPath);
    } else {
      RED.log.error("Dev Copilot sidebar file not found: " + sidebarPath);
      res.status(404).send("Sidebar file not found");
    }
  });

  // API 端点：发送消息给 copilot
  RED.httpAdmin.post("/dev-copilot/chat", async function (req, res) {
    try {
      const { message, nodeId, history } = req.body;

      // 调试信息
      console.log("🔍 Chat API 调试信息:");
      console.log(`   请求的 nodeId: ${nodeId}`);
      console.log(`   消息内容: ${message}`);

      // 如果没有提供nodeId，尝试查找可用的节点
      let node;
      if (nodeId) {
        node = RED.nodes.getNode(nodeId);
        console.log(`   查找节点结果: ${node ? "找到" : "未找到"}`);

        if (!node) {
          // 提供更详细的调试信息
          const allNodes = [];
          RED.nodes.eachNode(function (n) {
            if (n.type === "dev-copilot") {
              const runtimeNode = RED.nodes.getNode(n.id);
              allNodes.push({
                configId: n.id,
                runtimeExists: !!runtimeNode,
                name: n.name || "未命名",
              });
            }
          });

          console.log("   所有 dev-copilot 节点状态:", allNodes);

          return res.status(404).json({
            error: `选定的节点 (ID: ${nodeId}) 未找到。\n\n可能的原因：\n1. 节点未正确部署 - 请点击"部署"按钮\n2. 节点配置有错误 - 请检查节点配置\n3. 节点ID已过期 - 请重新选择节点\n\n调试信息：\n当前可用节点: ${
              allNodes.length
            } 个\n${allNodes
              .map(
                (n) =>
                  `- ${n.name} (配置ID: ${n.configId}, 运行时: ${
                    n.runtimeExists ? "✓" : "✗"
                  })`
              )
              .join("\n")}`,
          });
        }
      } else {
        // 查找第一个可用的运行时dev-copilot节点
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
              "未找到可用的Dev Copilot节点。请按以下步骤操作：\n\n1️⃣ 创建节点: 从左侧面板拖拽'dev copilot'节点到画布\n2️⃣ 配置节点: 双击节点配置LLM提供商和API密钥\n3️⃣ 部署节点: 点击右上角红色的'部署'按钮\n4️⃣ 刷新页面: 重新加载侧边栏\n5️⃣ 选择节点: 在上方下拉框中选择已部署的节点\n\n💡 提示：确保节点配置完整且已成功部署",
          });
        }
        node = foundNode;
        console.log("   自动选择节点:", node.name || node.id);
      }

      // 检查节点配置
      if (!node.apiKey) {
        return res.status(400).json({
          error: `节点配置不完整：缺少${node.provider}的API密钥。请双击节点进行配置。`,
        });
      }

      // 构建消息
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

      // 调用 LLM
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

  // API 端点：获取可用的 dev-copilot 节点
  RED.httpAdmin.get("/dev-copilot/nodes", function (req, res) {
    const nodes = [];

    // 获取运行时节点实例
    RED.nodes.eachNode(function (configNode) {
      if (configNode.type === "dev-copilot") {
        // 查找对应的运行时节点实例
        const runtimeNode = RED.nodes.getNode(configNode.id);
        if (runtimeNode) {
          nodes.push({
            id: runtimeNode.id,
            name: runtimeNode.name || configNode.name || "Dev Copilot",
            provider: runtimeNode.provider || configNode.provider,
            model: runtimeNode.model || configNode.model,
            status: "deployed", // 有运行时实例说明已部署
          });
        } else {
          // 配置存在但未部署
          nodes.push({
            id: configNode.id,
            name: configNode.name || "Dev Copilot",
            provider: configNode.provider,
            model: configNode.model,
            status: "not_deployed", // 未部署
          });
        }
      }
    });

    res.json(nodes);
  });
};
