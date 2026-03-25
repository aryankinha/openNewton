let mcpAuthenticated = false;

export function setMcpAuthenticated(value) {
  mcpAuthenticated = Boolean(value);
}

export function isMcpAuthenticated() {
  return mcpAuthenticated;
}
