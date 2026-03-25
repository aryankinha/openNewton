import { Command } from "commander";
import cron from "node-cron";
import { initConfig, loadConfig, validateConfig } from "../config/index.js";
import { runChat } from "./chat.js";
import {
  getRunningSchedulerPids,
  killAllSchedulerSessions,
  startBackgroundScheduler,
  stopBackgroundScheduler
} from "./processManager.js";
import { runAutonomousMonitorJob, runDailyPlanJob, startScheduler } from "../scheduler/index.js";
import { disconnectMcpServers, ensureMcpAuth, loadMcpServers } from "../mcp/index.js";
import { sendTelegram, startTelegramBot } from "../notifier/index.js";
import { showLogo, showStartupMessage } from "../ui/display.js";
import { UI } from "../ui/logger.js";
import { buildMockMonitoringSnapshot } from "./mockMonitoringData.js";
import { getStatePath, loadState, resetState } from "../state/index.js";
import { callLLM } from "../llm/index.js";

let startupRendered = false;

async function requireMcpAuth() {
  const authenticated = await ensureMcpAuth();
  if (!authenticated) {
    throw new Error("MCP authentication required. Run MCP once manually.");
  }
}

function statusLine(name, ok, detail = "") {
  return `- ${name}: ${ok ? "OK" : `FAIL${detail ? ` (${detail})` : ""}`}`;
}

function isTransientLlmLimitError(message) {
  const value = String(message || "");
  return /rate-limited|quota exceeded|retry in|too many requests|\(429\)|free_tier_requests/i.test(value);
}

async function runSchedulerProcess() {
  const cfg = await loadConfig();
  validateConfig(cfg);
  await loadMcpServers(cfg);
  await requireMcpAuth();

  const task = startScheduler();
  const bot = startTelegramBot(cfg);

  process.on("SIGTERM", () => {
    bot.stop();
    task.stop();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    bot.stop();
    task.stop();
    process.exit(0);
  });

  UI.success("Scheduler + Telegram listener running");
}

export async function runCli() {
  if (!startupRendered) {
    showLogo();
    showStartupMessage();
    startupRendered = true;
  }

  const program = new Command();

  program
    .name("newton-agent")
    .description("AI-powered academic assistant CLI")
    .version("0.1.0");

  program
    .command("init")
    .description("Setup newton-agent configuration")
    .action(async () => {
      const setup = await initConfig();
      if (setup?.startNow) {
        try {
          await startBackgroundScheduler();
          UI.success("Background monitoring started");
        } catch (error) {
          const message = String(error?.message || "");
          if (message.includes("Scheduler already running")) {
            UI.info("Background monitoring is already running.");
            UI.info("Use 'newton-agent start --restart' if you want to restart it.");
            return;
          }
          throw error;
        }
      }
    });

  program
    .command("start")
    .description("Start the daily scheduler")
    .option("--foreground", "Run scheduler in current terminal")
    .option("--restart", "Restart existing scheduler session if already running")
    .option("--run-now", "Run job once immediately after scheduler starts")
    .action(async (options) => {
      const cfg = await loadConfig();
      validateConfig(cfg);

      if (options.foreground) {
        const running = await getRunningSchedulerPids();
        if (running.length > 0 && !options.restart) {
          throw new Error(
            `Scheduler already running with PID(s): ${running.join(", ")}. Use --restart to replace it.`
          );
        }

        if (running.length > 0 && options.restart) {
          const stopped = await killAllSchedulerSessions();
          if (stopped.stopped.length > 0) {
            UI.info(`Stopped previous scheduler session(s): ${stopped.stopped.join(", ")}`);
          }
        }

        await loadMcpServers(cfg);
        await requireMcpAuth();
        const task = startScheduler();
        const bot = startTelegramBot(cfg);
        UI.success("Scheduler running in foreground. Press Ctrl+C to stop.");

        if (options.runNow) {
          await runDailyPlanJob();
        }

        process.on("SIGINT", () => {
          bot.stop();
          task.stop();
          process.exit(0);
        });
        return;
      }

      await startBackgroundScheduler({ restart: options.restart });
    });

  program
    .command("stop")
    .description("Stop the background scheduler process")
    .action(async () => {
      await stopBackgroundScheduler();
    });

  program
    .command("chat")
    .description("Start interactive CLI chat")
    .action(async () => {
      const cfg = await loadConfig();
      validateConfig(cfg);
      await loadMcpServers(cfg);
      await requireMcpAuth();
      await runChat();
    });

  program
    .command("telegram-listen")
    .description("Run Telegram listener only (without scheduler)")
    .action(async () => {
      const cfg = await loadConfig();
      validateConfig(cfg);
      await loadMcpServers(cfg);
      await requireMcpAuth();

      const bot = startTelegramBot(cfg);
      UI.success("Telegram listener running. Press Ctrl+C to stop.");

      process.on("SIGINT", () => {
        bot.stop();
        process.exit(0);
      });
    });

  program
    .command("doctor")
    .description("Run end-to-end setup diagnostics")
    .action(async () => {
      const status = {
        config: { ok: false, detail: "" },
        llm: { ok: false, detail: "", warningOnly: false },
        mcp: { ok: false, detail: "" },
        telegram: { ok: false, detail: "" },
        scheduler: { ok: false, detail: "" }
      };

      let cfg = null;
      try {
        cfg = await loadConfig();
        validateConfig(cfg);
        status.config.ok = true;
      } catch (error) {
        status.config.detail = error.message;
      }

      if (status.config.ok && cfg) {
        try {
          await callLLM([{ role: "user", content: "Reply with exactly: doctor-ok" }], { config: cfg });
          status.llm.ok = true;
        } catch (error) {
          status.llm.detail = error.message;
          if (isTransientLlmLimitError(error.message)) {
            status.llm.warningOnly = true;
          }
        }

        try {
          await loadMcpServers(cfg);
          await requireMcpAuth();
          status.mcp.ok = true;
        } catch (error) {
          status.mcp.detail = error.message;
        }

        try {
          await sendTelegram("Newton Agent doctor check: Setup successful.", { config: cfg });
          status.telegram.ok = true;
        } catch (error) {
          status.telegram.detail = error.message;
        }

        try {
          status.scheduler.ok =
            cron.validate("0 8 * * *") &&
            cron.validate("0 */3 * * *");
          if (!status.scheduler.ok) {
            status.scheduler.detail = "Invalid cron schedule expression";
          }
        } catch (error) {
          status.scheduler.detail = error.message;
        }
      }

      UI.info("STATUS:");
      UI.info(statusLine("CONFIG", status.config.ok, status.config.detail));
      UI.info(statusLine("LLM", status.llm.ok, status.llm.detail));
      UI.info(statusLine("MCP", status.mcp.ok, status.mcp.detail));
      UI.info(statusLine("TELEGRAM", status.telegram.ok, status.telegram.detail));
      UI.info(statusLine("SCHEDULER", status.scheduler.ok, status.scheduler.detail));

      if (!status.llm.ok && status.llm.warningOnly) {
        UI.info("LLM note: Temporary provider quota/rate limit detected. Retry later or run 'newton-agent init' to switch model/provider.");
      }

      const hasHardFailure =
        !status.config.ok ||
        !status.mcp.ok ||
        !status.telegram.ok ||
        !status.scheduler.ok ||
        (!status.llm.ok && !status.llm.warningOnly);

      await disconnectMcpServers();

      if (hasHardFailure) {
        throw new Error("Doctor checks failed");
      }

      if (!status.llm.ok && status.llm.warningOnly) {
        UI.success("Doctor checks passed with LLM quota warning");
      } else {
        UI.success("Doctor checks passed");
      }
    });

  program
    .command("monitor-now")
    .description("Run autonomous monitor immediately")
    .option("--mock", "Use mocked data snapshot for verification")
    .option("--dry-run", "Do not send Telegram message")
    .action(async (options) => {
      if (!options.mock) {
        const cfg = await loadConfig();
        validateConfig(cfg);
        await loadMcpServers(cfg);
        await requireMcpAuth();
      }

      const snapshotOverride = options.mock ? buildMockMonitoringSnapshot() : null;
      const result = await runAutonomousMonitorJob({
        snapshotOverride,
        sendNotification: !options.dryRun
      });

      UI.success("Monitor run complete");
      UI.info(JSON.stringify(result?.counts || {}, null, 2));
      if (result?.message) {
        UI.info("\n--- Alert Preview ---\n");
        UI.info(result.message);
      }
    });

  program
    .command("state-status")
    .description("Show autonomous alert state")
    .action(async () => {
      const state = await loadState();
      UI.success(`State file: ${getStatePath()}`);
      UI.info(JSON.stringify(state, null, 2));
    });

  program
    .command("state-reset")
    .description("Reset autonomous alert state")
    .action(async () => {
      const state = await resetState();
      UI.success("State reset complete");
      UI.info(JSON.stringify(state, null, 2));
    });

  // Internal command used by the detached background process.
  program
    .command("run-scheduler")
    .description("Internal scheduler runner")
    .action(async () => {
      await runSchedulerProcess();
    });

  program.action(async () => {
    try {
      const cfg = await loadConfig();
      validateConfig(cfg);
      await startBackgroundScheduler();
      UI.success("Newton Agent started in background");
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("Config not found")) {
        UI.agent("No config found. Starting guided setup...");
        const setup = await initConfig();
        if (setup?.startNow) {
          await startBackgroundScheduler();
          UI.success("Newton Agent started in background");
        } else {
          UI.info("Run 'newton-agent start' when you are ready.");
        }
        return;
      }
      throw error;
    }
  });

  await program.parseAsync(process.argv);
}
