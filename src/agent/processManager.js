import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { ensureAppDir, getPidPath } from "../config/index.js";
import { UI } from "../ui/logger.js";

async function readPid() {
  try {
    const pidText = await fs.readFile(getPidPath(), "utf-8");
    return Number(pidText.trim());
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parsePidList(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

async function findSchedulerPids() {
  return await new Promise((resolve) => {
    const finder = spawn("pgrep", ["-f", "(bin/cli.js|newton-agent) run-scheduler"], {
      stdio: ["ignore", "pipe", "ignore"]
    });

    let output = "";
    finder.stdout.on("data", (chunk) => {
      output += String(chunk || "");
    });

    finder.on("error", () => resolve([]));
    finder.on("close", () => resolve(parsePidList(output)));
  });
}

async function stopPidsGracefully(pids) {
  const unique = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  if (unique.length === 0) return [];

  for (const pid of unique) {
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore race conditions where process exits between checks.
      }
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 600));

  const forced = [];
  for (const pid of unique) {
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
        forced.push(pid);
      } catch {
        // Ignore if already gone.
      }
    }
  }

  return forced;
}

async function collectSchedulerPids() {
  const pidFromFile = await readPid();
  const scanned = await findSchedulerPids();
  return [pidFromFile, ...scanned].filter((pid) => Number.isInteger(pid) && pid > 0);
}

export async function getRunningSchedulerPids() {
  await ensureAppDir();
  const pids = await collectSchedulerPids();
  return [...new Set(pids)].filter((pid) => isProcessAlive(pid));
}

async function clearPidFile() {
  await fs.unlink(getPidPath()).catch(() => {});
}

export async function killAllSchedulerSessions() {
  await ensureAppDir();

  const pids = await collectSchedulerPids();
  if (pids.length === 0) {
    await clearPidFile();
    return { stopped: [], forced: [] };
  }

  const unique = [...new Set(pids)];
  const forced = await stopPidsGracefully(unique);
  await clearPidFile();

  return { stopped: unique, forced };
}

export async function startBackgroundScheduler(options = {}) {
  await ensureAppDir();
  const restart = Boolean(options.restart);

  const runningPids = await getRunningSchedulerPids();
  if (runningPids.length > 0 && !restart) {
    throw new Error(
      `Scheduler already running with PID(s): ${runningPids.join(", ")}. Use 'newton-agent start --restart' to restart.`
    );
  }

  const restartResult = restart ? await killAllSchedulerSessions() : { stopped: [], forced: [] };

  const child = spawn(process.execPath, ["bin/cli.js", "run-scheduler"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  await fs.writeFile(getPidPath(), `${child.pid}\n`, "utf-8");
  if (restartResult.stopped.length > 0) {
    const killedSummary = restartResult.forced.length > 0
      ? ` (forced: ${restartResult.forced.join(", ")})`
      : "";
    UI.info(`Stopped previous scheduler session(s): ${restartResult.stopped.join(", ")}${killedSummary}`);
  }
  UI.success(`Scheduler started in background (PID ${child.pid})`);
}

export async function stopBackgroundScheduler() {
  const result = await killAllSchedulerSessions();
  if (result.stopped.length === 0) {
    UI.info("No running scheduler found");
    return;
  }

  const forcedSummary = result.forced.length > 0
    ? ` (forced: ${result.forced.join(", ")})`
    : "";
  UI.success(`Stopped scheduler process(es): ${result.stopped.join(", ")}${forcedSummary}`);
}
