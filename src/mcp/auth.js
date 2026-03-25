import { callMcpToolRaw, getAvailableToolNames, getAvailableTools } from "./client.js";
import { setMcpAuthenticated } from "./authState.js";
import { showAuthRequired } from "../ui/display.js";
import { UI } from "../ui/logger.js";

const AUTH_ERROR_REGEX = /unauthorized|auth_required|authentication required|not authenticated|login required|forbidden/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveGetMeTool() {
  const tools = getAvailableTools();
  const names = tools.map((tool) => tool.name);
  return names.find((name) => /(^|_)get(_)?me$|^me$|^profile$/i.test(name)) || null;
}

function resolveDeviceLoginTool(getMeToolName) {
  const names = getAvailableToolNames();
  return (
    names.find(
      (name) =>
        name !== getMeToolName &&
        /(device.*login|start.*login|auth.*device|login|authorize|authorization)/i.test(name)
    ) || null
  );
}

function extractAuthContext(value) {
  if (!value || typeof value !== "object") return {};

  const content = Array.isArray(value.content) ? value.content : [];
  let parsedText = null;

  if (content.length > 0 && content[0]?.type === "text") {
    const text = content[0].text || "";
    try {
      parsedText = JSON.parse(text);
    } catch {
      parsedText = null;
    }
  }

  const base = parsedText && typeof parsedText === "object" ? parsedText : value;
  return {
    verificationUrl:
      base.verification_url || base.verification_uri || base.verificationUrl || base.url || null,
    userCode: base.user_code || base.userCode || base.code || null
  };
}

function isAuthFailure(error) {
  return AUTH_ERROR_REGEX.test(String(error?.message || ""));
}

function isProfileComplete(profile) {
  if (!profile) return false;
  if (typeof profile === "string") return profile.trim().length > 0;
  if (Array.isArray(profile)) return profile.length > 0;
  if (typeof profile === "object") {
    return Object.keys(profile).length > 0;
  }
  return true;
}

async function startDeviceLoginFlow(getMeTool, context = {}) {
  const loginTool = resolveDeviceLoginTool(getMeTool);

  if (!loginTool) {
    UI.mcp("MCP authentication required. Run MCP once manually.");
    return null;
  }

  try {
    const loginResult = await callMcpToolRaw(loginTool, {});
    return {
      ...context,
      ...extractAuthContext(loginResult.raw),
      loginTool
    };
  } catch (error) {
    if (!isAuthFailure(error)) {
      throw error;
    }

    return {
      ...context,
      ...extractAuthContext(error),
      loginTool
    };
  }
}

async function pollForAuthentication(getMeTool, maxAttempts = 40) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    UI.mcp("Waiting for login");
    await sleep(3000);

    try {
      const meResult = await callMcpToolRaw(getMeTool, {});
      if (isProfileComplete(meResult.normalized)) {
        return true;
      }
    } catch {
      // Continue polling until timeout.
    }
  }

  return false;
}

export async function ensureMcpAuth(options = {}) {
  const contextFromCaller = options.authContext || {};
  const getMeTool = resolveGetMeTool();

  if (!getMeTool) {
    // Some MCP servers may not expose an identity tool; trust server-side auth.
    setMcpAuthenticated(true);
    UI.mcp("Authenticated");
    return true;
  }

  try {
    const me = await callMcpToolRaw(getMeTool, {});
    if (!isProfileComplete(me.normalized)) {
      throw new Error("Profile is incomplete");
    }

    setMcpAuthenticated(true);
    UI.mcp("Auth successful");
    return true;
  } catch (error) {
    setMcpAuthenticated(false);
    UI.mcp("Auth required");

    const authContext = await startDeviceLoginFlow(getMeTool, contextFromCaller);

    const verificationUrl = authContext?.verificationUrl;
    const userCode = authContext?.userCode;

    showAuthRequired(verificationUrl, userCode);

    const ok = await pollForAuthentication(getMeTool);
    if (!ok) {
      UI.mcp("MCP authentication required. Run MCP once manually.");
      return false;
    }

    setMcpAuthenticated(true);
    UI.mcp("Auth successful");
    return true;
  }
}
