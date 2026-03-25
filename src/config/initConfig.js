import inquirer from "inquirer";
import { spawn } from "node:child_process";
import { getConfigPath, saveConfig } from "./config.js";
import { MCP_TEMPLATES } from "../mcp/templates.js";
import { validateMcp } from "../mcp/validateMcp.js";
import { UI } from "../ui/logger.js";
import { callLLM } from "../llm/index.js";
import { DEFAULT_MODELS } from "../llm/providers.js";
import {
  callMcpTool,
  disconnectMcpServers,
  ensureMcpAuth,
  getAvailableToolNames,
  loadMcpServers
} from "../mcp/index.js";
import { sendTelegram } from "../notifier/index.js";

const PROVIDERS = [
  "openrouter",
  "openai",
  "claude",
  "gemini",
  "grok",
  "huggingface"
];

function formatCheckLine(name, ok, detail = "") {
  return ok ? `${name}: OK` : `${name}: FAIL${detail ? ` (${detail})` : ""}`;
}

function resolveDefaultModel(provider, customModel) {
  const explicit = String(customModel || "").trim();
  if (explicit) return explicit;
  return DEFAULT_MODELS[provider] || null;
}

function isTransientLlmLimitError(message) {
  const value = String(message || "");
  return /rate-limited|quota exceeded|retry in|too many requests|\(429\)|free_tier_requests/i.test(value);
}

async function verifyLlm(config) {
  await callLLM([{ role: "user", content: "Reply with exactly: setup-ok" }], { config });
}

async function verifyTelegramWithRetry(config) {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      await sendTelegram("Setup successful", { config });
      return;
    } catch (error) {
      attempt += 1;
      const shouldRetry = attempt < maxAttempts
        ? await inquirer
            .prompt([
              {
                type: "confirm",
                name: "retryTelegram",
                message: `Telegram test failed: ${error.message}. Retry?`,
                default: true
              }
            ])
            .then((value) => value.retryTelegram)
        : false;

      if (!shouldRetry) {
        throw new Error(error.message);
      }
    }
  }

  throw new Error("Telegram validation failed after retries");
}

async function verifyMcp(config) {
  UI.info("Running Newton login helper...");
  await runNewtonLoginCli();

  await loadMcpServers(config);
  const authenticated = await ensureMcpAuth();

  if (!authenticated) {
    throw new Error("MCP authentication required. Run MCP once manually.");
  }

  const toolNames = getAvailableToolNames();
  const getMeTool = toolNames.find((name) => /(^|_)get(_)?me$|^me$|^profile$/i.test(name));

  if (!getMeTool) {
    throw new Error("MCP get_me tool not found");
  }

  await callMcpTool(getMeTool, {});
}

async function runNewtonLoginCli() {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["-y", "@newtonschool/newton-mcp@latest", "login"], {
      stdio: "inherit"
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to run Newton MCP login helper: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Newton MCP login helper exited with code ${code}. ` +
            "Run: npx -y @newtonschool/newton-mcp@latest login"
        )
      );
    });
  });
}

async function verifySetup(config) {
  const checks = [];

  try {
    await verifyLlm(config);
    checks.push(formatCheckLine("LLM", true));
  } catch (error) {
    if (isTransientLlmLimitError(error.message)) {
      checks.push(`LLM: WARN (${error.message})`);
    } else {
      checks.push(formatCheckLine("LLM", false, error.message));
    }
  }

  try {
    await verifyTelegramWithRetry(config);
    checks.push(formatCheckLine("Telegram", true));
  } catch (error) {
    checks.push(formatCheckLine("Telegram", false, error.message));
  }

  try {
    await verifyMcp(config);
    checks.push(formatCheckLine("MCP", true));
  } catch (error) {
    checks.push(formatCheckLine("MCP", false, error.message));
  } finally {
    await disconnectMcpServers();
  }

  return checks;
}

export async function initConfig() {
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: "Select LLM provider:",
      choices: PROVIDERS,
      default: "openrouter"
    },
    {
      type: "password",
      name: "apiKey",
      message: "Enter LLM API key:",
      mask: "*",
      validate: (value) => (value ? true : "API key is required")
    },
    {
      type: "input",
      name: "customModel",
      message: (answers) => {
        const defaultModel = DEFAULT_MODELS[answers.provider] || "<provider default>";
        return `Model override (press Enter to use default: ${defaultModel}):`;
      },
      default: ""
    },
    {
      type: "password",
      name: "telegramBotToken",
      message: "Enter Telegram bot token:",
      mask: "*",
      validate: (value) => (value ? true : "Telegram bot token is required")
    },
    {
      type: "input",
      name: "telegramChatId",
      message: "Enter Telegram chat ID:",
      validate: (value) => (value ? true : "Telegram chat ID is required")
    },
    {
      type: "list",
      name: "mcpPreset",
      message: "Choose MCP setup:",
      choices: [
        { name: "Newton School MCP (recommended)", value: "newton" },
        { name: "Custom MCP", value: "custom" },
        { name: "Skip MCP for now", value: "none" }
      ],
      default: "newton"
    },
    {
      type: "input",
      name: "customMcpName",
      message: "MCP server name:",
      when: (answers) => answers.mcpPreset === "custom",
      validate: (value) => (value ? true : "Server name is required")
    },
    {
      type: "input",
      name: "customMcpCommand",
      message: "MCP command:",
      when: (answers) => answers.mcpPreset === "custom",
      validate: (value) => (value ? true : "Command is required")
    },
    {
      type: "input",
      name: "customMcpArgs",
      message: "MCP args (comma separated):",
      when: (answers) => answers.mcpPreset === "custom",
      default: ""
    },
    {
      type: "confirm",
      name: "startNow",
      message: "Start background monitoring now?",
      default: true
    }
  ]);

  const mcpServers = {};
  if (answers.mcpPreset === "newton") {
    const template = MCP_TEMPLATES.newton;
    const server = {
      type: template.type,
      command: template.command,
      args: template.args
    };
    validateMcp(server);
    mcpServers.newton = server;
  } else if (answers.mcpPreset === "custom") {
    const customArgs = String(answers.customMcpArgs || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const server = {
      type: "npx",
      command: answers.customMcpCommand,
      args: customArgs
    };

    validateMcp(server);
    mcpServers[answers.customMcpName] = server;
  }

  const config = {
    llm: {
      provider: answers.provider,
      apiKey: answers.apiKey,
      model: resolveDefaultModel(answers.provider, answers.customModel)
    },
    telegram: {
      botToken: answers.telegramBotToken,
      chatId: answers.telegramChatId
    },
    mcpServers
  };

  await saveConfig(config);
  UI.success(`Config saved to ${getConfigPath()}`);

  UI.agent("Running setup checks...");
  const checks = await verifySetup(config);
  let failed = false;
  let llmWarn = false;

  for (const line of checks) {
    if (line.includes("FAIL")) {
      failed = true;
      UI.error(line);
    } else if (line.startsWith("LLM: WARN")) {
      llmWarn = true;
      UI.info(line);
    } else {
      UI.success(line);
    }
  }

  if (failed) {
    throw new Error("Setup checks failed. Fix errors above and run init again.");
  }

  if (llmWarn) {
    UI.info("Setup completed with LLM quota warning. Monitoring and Telegram will work; chat replies may fail until quota resets or you switch provider/model.");
  }

  return {
    config,
    startNow: Boolean(answers.startNow)
  };
}
