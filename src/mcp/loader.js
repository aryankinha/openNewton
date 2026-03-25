import { validateMcp } from "./validateMcp.js";
import { clearMcpClientState, connectMcpServer, getAvailableTools } from "./client.js";
import { setAgentTools } from "../agent/tools.js";
import { UI } from "../ui/logger.js";

export async function loadMcpServers(config) {
  const servers = config?.mcpServers || {};
  const initialized = {};

  clearMcpClientState();

  for (const [name, server] of Object.entries(servers)) {
    validateMcp(server, name);

    const tools = await connectMcpServer(name, server);
    initialized[name] = {
      name,
      type: server.type || "npx",
      command: server.command,
      args: server.args,
      initialized: true,
      toolsLoaded: tools.length
    };
  }

  setAgentTools(getAvailableTools());

  if (Object.keys(initialized).length === 0) {
    UI.mcp("No MCP servers configured");
  } else {
    UI.mcp(`Tools loaded: ${getAvailableTools().length}`);
  }

  return initialized;
}
