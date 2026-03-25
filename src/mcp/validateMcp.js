export function validateMcp(server, serverName = "unknown") {
  if (!server || typeof server !== "object") {
    throw new Error(`Invalid MCP server config for '${serverName}': must be an object`);
  }

  if (!server.command || typeof server.command !== "string") {
    throw new Error(`Invalid MCP server config for '${serverName}': command must be a string`);
  }

  if (!Array.isArray(server.args)) {
    throw new Error(`Invalid MCP server config for '${serverName}': args must be an array`);
  }

  return true;
}
