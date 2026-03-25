import cron from "node-cron";
import { runAgent } from "../agent/agentEngine.js";
import { sendTelegram } from "../notifier/index.js";
import { UI } from "../ui/logger.js";
import {
  detectHeavyDay,
  detectMissedLectures,
  detectUpcomingDeadlines,
  detectUrgentAssignments
} from "../agent/eventEngine.js";
import { fetchMonitoringSnapshot } from "../agent/monitoringData.js";
import { loadState, saveState } from "../state/index.js";
import { buildSmartNotification } from "../notifier/notificationFormatter.js";

function computeHoursRemaining(value) {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  return (due.getTime() - Date.now()) / (1000 * 60 * 60);
}

async function withRetry(fn, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function filterNewItems(items, seenIds) {
  return items.filter((item) => !seenIds.has(item.id));
}

export async function runAutonomousMonitorJob(options = {}) {
  const snapshotOverride = options.snapshotOverride || null;
  const sendNotification = options.sendNotification ?? true;

  UI.agent("Checking events");

  const state = await loadState();
  const snapshot = snapshotOverride || (await withRetry(() => fetchMonitoringSnapshot(), 2));

  const enrichedAssignments = snapshot.assignments.map((item) => ({
    ...item,
    hoursRemaining: computeHoursRemaining(item.dueAt)
  }));

  const urgent = detectUrgentAssignments(enrichedAssignments);
  const upcoming = detectUpcomingDeadlines(enrichedAssignments);
  const missed = detectMissedLectures(snapshot.lectures);
  const heavyDay = detectHeavyDay(snapshot.calendar, snapshot.assignments);

  UI.event(`Urgent assignments detected: ${urgent.length}`);
  UI.event(`Upcoming deadlines detected: ${upcoming.length}`);
  UI.event(`Missed lectures detected: ${missed.length}`);

  const alertedAssignments = new Set(state.alertedAssignments || []);
  const alertedLectures = new Set(state.alertedLectures || []);
  const alertedHeavyDays = new Set(state.alertedHeavyDays || []);

  const newUrgent = filterNewItems(urgent, alertedAssignments);
  const newUpcoming = filterNewItems(upcoming, alertedAssignments).filter(
    (item) => !newUrgent.some((urgentItem) => urgentItem.id === item.id)
  );
  const newMissed = filterNewItems(missed, alertedLectures);

  const todayKey = new Date().toISOString().slice(0, 10);
  const shouldAlertHeavyDay = heavyDay.isHeavy && !alertedHeavyDays.has(todayKey);

  const shouldNotify =
    newUrgent.length > 0 ||
    newUpcoming.length > 0 ||
    newMissed.length > 0 ||
    shouldAlertHeavyDay;

  if (!shouldNotify) {
    UI.notify("No new alerts to send");
    return {
      sent: false,
      reason: "no-new-events",
      message: null,
      counts: {
        urgent: newUrgent.length,
        upcoming: newUpcoming.length,
        missed: newMissed.length,
        heavyDay: shouldAlertHeavyDay ? 1 : 0
      }
    };
  }

  const message = buildSmartNotification({
    calendar: snapshot.calendar,
    assignments: enrichedAssignments,
    missedLectures: missed
  });

  if (sendNotification) {
    UI.notify("Sending alert");
    await withRetry(() => sendTelegram(message), 2);
  } else {
    UI.notify("Dry run: alert not sent");
  }

  for (const item of [...newUrgent, ...newUpcoming]) {
    alertedAssignments.add(item.id);
  }
  for (const lecture of newMissed) {
    alertedLectures.add(lecture.id);
  }
  if (shouldAlertHeavyDay) {
    alertedHeavyDays.add(todayKey);
  }

  await saveState({
    ...state,
    alertedAssignments: Array.from(alertedAssignments),
    alertedLectures: Array.from(alertedLectures),
    alertedHeavyDays: Array.from(alertedHeavyDays)
  });

  return {
    sent: sendNotification,
    reason: "new-events",
    message,
    counts: {
      urgent: newUrgent.length,
      upcoming: newUpcoming.length,
      missed: newMissed.length,
      heavyDay: shouldAlertHeavyDay ? 1 : 0
    }
  };
}

export async function runDailyPlanJob() {
  UI.agent("Running daily plan job...");
  const message = await runAgent(
    "Analyze schedule, assignments, and lectures. Generate today's structured plan with priorities."
  );

  await withRetry(() => sendTelegram(message), 2);
  const state = await loadState();
  await saveState({
    ...state,
    lastSummarySent: new Date().toISOString()
  });
  UI.success("Daily plan sent to Telegram");
}

export function startScheduler() {
  UI.agent("Scheduling daily summary at 08:00");
  UI.agent("Scheduling autonomous monitor every 3 hours");

  const dailyTask = cron.schedule("0 8 * * *", async () => {
    try {
      await runDailyPlanJob();
    } catch (error) {
      UI.error(`Scheduler job failed: ${error.message}`);
    }
  });

  const monitorTask = cron.schedule("0 */3 * * *", async () => {
    try {
      await runAutonomousMonitorJob();
    } catch (error) {
      UI.error(`Autonomous monitor failed: ${error.message}`);
    }
  });

  return {
    stop() {
      dailyTask.stop();
      monitorTask.stop();
    }
  };
}
