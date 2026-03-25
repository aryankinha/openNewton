import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ensureMcpAuth } from "./auth.js";
import { UI } from "../ui/logger.js";

const serverRegistry = new Map();
const toolRegistry = new Map();

const AUTH_ERROR_REGEX = /unauthorized|auth_required|authentication required|not authenticated|login required|forbidden/i;

function normalizeToolResult(result) {
  const content = result?.content;
  if (!Array.isArray(content)) {
    return result;
  }

  if (content.length === 1 && content[0]?.type === "text") {
    const text = content[0].text || "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return content.map((item) => {
    if (item?.type === "text") {
      try {
        return JSON.parse(item.text || "");
      } catch {
        return item.text || "";
      }
    }
    return item;
  });
}

function isEmptyResult(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isLikelyDataTool(toolName) {
  return /assignment|calendar|schedule|lecture|class|deadline/i.test(String(toolName || ""));
}

function extractAuthContext(value) {
  if (!value || typeof value !== "object") return {};

  return {
    verificationUrl:
      value.verification_url ||
      value.verification_uri ||
      value.verificationUrl ||
      value.url ||
      null,
    userCode: value.user_code || value.userCode || value.code || null
  };
}

function detectAuthRequirement(toolName, rawResult, normalizedResult, error) {
  const errorMessage = String(error?.message || "");
  const serializedRaw = rawResult ? JSON.stringify(rawResult) : "";

  if (AUTH_ERROR_REGEX.test(errorMessage) || AUTH_ERROR_REGEX.test(serializedRaw)) {
    return {
      required: true,
      reason: errorMessage || "auth_required",
      context: {
        ...extractAuthContext(rawResult),
        ...extractAuthContext(error)
      }
    };
  }

  if (isLikelyDataTool(toolName) && isEmptyResult(normalizedResult)) {
    return {
      required: true,
      reason: "missing data unexpectedly",
      context: extractAuthContext(rawResult)
    };
  }

  return { required: false, reason: null, context: {} };
}

export function getAvailableToolNames() {
  return Array.from(toolRegistry.keys());
}

export async function callMcpToolRaw(toolName, params = {}) {
  const toolInfo = toolRegistry.get(toolName);
  if (!toolInfo) {
    throw new Error(`Unknown MCP tool: ${toolName}`);
  }

  const serverEntry = serverRegistry.get(toolInfo.serverName);
  if (!serverEntry?.client) {
    throw new Error(`MCP server not connected for tool: ${toolName}`);
  }

  UI.mcp(`Calling tool: ${toolName}`);
  const spinner = UI.spinner("Thinking...");
  spinner.start();

  let raw;
  try {
    raw = await serverEntry.client.callTool({
      name: toolName,
      arguments: params
    });
    spinner.succeed("Done");
  } catch (error) {
    spinner.fail("Error");
    throw error;
  }

  return {
    raw,
    normalized: normalizeToolResult(raw)
  };
}

export async function connectMcpServer(name, server) {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args
  });

  const client = new Client(
    {
      name: `newton-agent-${name}`,
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  await client.connect(transport);
  UI.mcp(`Connected (${name})`);

  const listed = await client.listTools();
  const tools = listed?.tools || [];

  serverRegistry.set(name, {
    name,
    client,
    transport,
    server,
    tools
  });

  for (const tool of tools) {
    toolRegistry.set(tool.name, {
      ...tool,
      serverName: name
    });
  }

  UI.mcp(`Tools loaded (${name}): ${tools.length}`);
  return tools;
}

export function getAvailableTools() {
  return Array.from(toolRegistry.values()).map((tool) => ({
    name: tool.name,
    description: tool.description || "No description provided"
  }));
}

export async function callMcpTool(toolName, params = {}) {
  try {
    const first = await callMcpToolRaw(toolName, params);
    const authState = detectAuthRequirement(toolName, first.raw, first.normalized);

    if (!authState.required) {
      return first.normalized;
    }

    UI.mcp("Auth required");
    const ok = await ensureMcpAuth({
      reason: authState.reason,
      authContext: authState.context
    });

    if (!ok) {
      throw new Error("Authentication failed");
    }

    const retried = await callMcpToolRaw(toolName, params);
    return retried.normalized;
  } catch (error) {
    const authState = detectAuthRequirement(toolName, null, null, error);
    if (!authState.required) {
      throw error;
    }

    UI.mcp("Auth required");
    const ok = await ensureMcpAuth({
      reason: authState.reason,
      authContext: authState.context
    });

    if (!ok) {
      throw new Error("Authentication failed");
    }

    const retried = await callMcpToolRaw(toolName, params);
    return retried.normalized;
  }
}

export function clearMcpClientState() {
  serverRegistry.clear();
  toolRegistry.clear();
}

export async function disconnectMcpServers() {
  const entries = Array.from(serverRegistry.values());

  for (const entry of entries) {
    try {
      if (entry?.client && typeof entry.client.close === "function") {
        await entry.client.close();
      }
    } catch {
      // Best effort shutdown.
    }

    try {
      if (entry?.transport && typeof entry.transport.close === "function") {
        await entry.transport.close();
      }
    } catch {
      // Best effort shutdown.
    }
  }

  clearMcpClientState();
}
