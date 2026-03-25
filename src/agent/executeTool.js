import { callMcpTool } from "../mcp/index.js";
import { UI } from "../ui/logger.js";

export async function executeTool(toolCall) {
  const name = toolCall?.name;
  const args = toolCall?.arguments ?? {};

  if (!name) {
    throw new Error(`Unknown tool: ${name}`);
  }

  UI.agent(`Calling tool: ${name}`);
  let result;
  try {
    result = await callMcpTool(name, args);
  } catch (error) {
    const message = String(error?.message || "");
    if (/authentication failed|not authenticated|auth required|unauthorized/i.test(message)) {
      return "You are not logged into Newton. Please login first.";
    }
    throw error;
  }
  UI.agent(`Tool completed: ${name}`);

  return result;
}
