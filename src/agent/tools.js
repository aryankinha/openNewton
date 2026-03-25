export const AGENT_TOOLS = [];

export function setAgentTools(tools = []) {
  AGENT_TOOLS.length = 0;
  AGENT_TOOLS.push(
    ...tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "No description provided"
    }))
  );
}

export function getAgentTools() {
  return AGENT_TOOLS;
}
