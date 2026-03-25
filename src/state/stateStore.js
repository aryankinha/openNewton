import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureAppDir, getAppDir } from "../config/index.js";

const STATE_PATH = path.join(getAppDir(), "state.json");

function defaultState() {
  return {
    alertedAssignments: [],
    alertedLectures: [],
    lastSummarySent: null,
    alertedHeavyDays: []
  };
}

export function getDefaultState() {
  return defaultState();
}

export function getStatePath() {
  return STATE_PATH;
}

export async function loadState() {
  await ensureAppDir();

  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      alertedAssignments: Array.isArray(parsed?.alertedAssignments) ? parsed.alertedAssignments : [],
      alertedLectures: Array.isArray(parsed?.alertedLectures) ? parsed.alertedLectures : [],
      alertedHeavyDays: Array.isArray(parsed?.alertedHeavyDays) ? parsed.alertedHeavyDays : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Failed to load state: ${error.message}`);
    }

    const initial = defaultState();
    await saveState(initial);
    return initial;
  }
}

export async function saveState(state) {
  await ensureAppDir();
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  await fs.chmod(STATE_PATH, 0o600);
}

export async function resetState() {
  const initial = defaultState();
  await saveState(initial);
  return initial;
}
