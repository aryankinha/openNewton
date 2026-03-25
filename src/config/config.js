import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateMcp } from "../mcp/validateMcp.js";

const APP_DIR = path.join(os.homedir(), ".newton-agent");
const CONFIG_PATH = path.join(APP_DIR, "config.json");
const PID_PATH = path.join(APP_DIR, "scheduler.pid");

export function getAppDir() {
  return APP_DIR;
}

export function getConfigPath() {
  return CONFIG_PATH;
}

export function getPidPath() {
  return PID_PATH;
}

export async function ensureAppDir() {
  await fs.mkdir(APP_DIR, { recursive: true, mode: 0o700 });
}

export async function saveConfig(config) {
  await ensureAppDir();
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  await fs.chmod(CONFIG_PATH, 0o600);
}

export async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    // Backward-compatible config migration for older files.
    if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
      parsed.mcpServers = {};
    }

    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Config not found at ${CONFIG_PATH}. Run: newton-agent init`);
    }
    throw new Error(`Failed to load config: ${error.message}`);
  }
}

export function validateConfig(config) {
  const missing = [];
  if (!config?.llm?.provider) missing.push("llm.provider");
  if (!config?.llm?.apiKey) missing.push("llm.apiKey");
  if (!config?.telegram?.botToken) missing.push("telegram.botToken");
  if (!config?.telegram?.chatId) missing.push("telegram.chatId");

  if (missing.length > 0) {
    throw new Error(`Invalid config. Missing: ${missing.join(", ")}`);
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    throw new Error("Invalid config. mcpServers must be an object");
  }

  for (const [name, server] of Object.entries(config.mcpServers)) {
    validateMcp(server, name);
  }

  return true;
}
