function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getTomorrow(date) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

function formatClock(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function truncateTitle(title, max = 50) {
  const value = String(title || "Untitled").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

export function formatTime(timestamp) {
  const now = new Date();
  const date = toDate(timestamp);
  if (!date) return "time unknown";

  const hours = (date.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hours > 0 && hours < 6) {
    return `in ${Math.max(1, Math.round(hours))}h`;
  }

  if (isSameDay(date, now)) {
    return `today ${formatClock(date)}`;
  }

  if (isSameDay(date, getTomorrow(now))) {
    return "tomorrow";
  }

  if (hours > 0 && hours < 48) {
    return `in ${Math.round(hours)}h`;
  }

  return date.toISOString().slice(0, 10);
}

function formatTimeLeft(hoursRemaining) {
  if (typeof hoursRemaining !== "number") return "time unknown";
  if (hoursRemaining <= 0) return "due now";
  if (hoursRemaining < 1) return "in <1h";
  return `in ${Math.round(hoursRemaining)}h`;
}

function sortByUrgency(assignments) {
  return [...assignments]
    .filter((item) => typeof item.hoursRemaining === "number" && item.hoursRemaining > 0)
    .sort((a, b) => a.hoursRemaining - b.hoursRemaining);
}

function getTodayAndTomorrowDeadlineCounts(assignments) {
  const now = new Date();
  const tomorrow = getTomorrow(now);

  let dueToday = 0;
  let dueTomorrow = 0;

  for (const assignment of assignments) {
    const due = toDate(assignment?.dueAt);
    if (!due) continue;

    if (isSameDay(due, now)) dueToday += 1;
    if (isSameDay(due, tomorrow)) dueTomorrow += 1;
  }

  return { dueToday, dueTomorrow };
}

function getClassesToday(calendar) {
  const now = new Date();
  return calendar
    .map((item) => ({ ...item, startDate: toDate(item?.start) }))
    .filter((item) => item.startDate && isSameDay(item.startDate, now));
}

function getNextClass(calendar) {
  const now = Date.now();
  const candidates = calendar
    .map((item) => ({ ...item, startDate: toDate(item?.start) }))
    .filter((item) => item.startDate && item.startDate.getTime() >= now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  return candidates[0] || null;
}

function buildNextAction(topPriority, nextClass, missedLectures) {
  if (topPriority.length > 0) {
    const top = topPriority[0];
    return `Finish \"${truncateTitle(top.title)}\" (${formatTimeLeft(top.hoursRemaining)})`;
  }

  if (nextClass) {
    return `Prepare for \"${truncateTitle(nextClass.title)}\" (${formatTime(nextClass.start)})`;
  }

  if (missedLectures.length > 0) {
    return `Review \"${truncateTitle(missedLectures[0].title)}\" recording/notes`;
  }

  return "Use this slot for focused revision.";
}

function buildPlan(topPriority, classesToday, missedLectures) {
  const lines = [];

  if (topPriority.length > 0) {
    lines.push(`Start with \"${truncateTitle(topPriority[0].title)}\" now.`);
  }

  if (classesToday.length > 0) {
    lines.push("Block 20 minutes before your next class for prep.");
  }

  if (missedLectures.length > 0) {
    lines.push("Catch up one missed lecture before end of day.");
  }

  if (lines.length < 2) {
    lines.push("Use one deep-work block for revision.");
  }

  return lines.slice(0, 3);
}

function buildInsight(classesTodayCount, topPriorityCount, dueToday) {
  if (classesTodayCount >= 4 && topPriorityCount >= 2) {
    return "You have a heavy workload today. Prioritize deadlines before classes.";
  }

  if (dueToday > 0) {
    return "Focus on assignments due today before lower-priority work.";
  }

  if (classesTodayCount <= 2 && topPriorityCount === 0) {
    return "Light day, good time to revise and build buffer.";
  }

  return "Steady day. Keep momentum with your next top task.";
}

function bullets(lines) {
  return lines.map((line) => `- ${line}`).join("\n");
}

export function buildSmartNotification({ calendar = [], assignments = [], missedLectures = [] }) {
  const classesToday = getClassesToday(calendar);
  const nextClass = getNextClass(calendar);
  const sorted = sortByUrgency(assignments);
  const topPriority = sorted.filter((item) => item.hoursRemaining <= 24).slice(0, 3);
  const missedTop = missedLectures.slice(0, 2);
  const { dueToday, dueTomorrow } = getTodayAndTomorrowDeadlineCounts(assignments);

  const nextAction = buildNextAction(topPriority, nextClass, missedTop);
  const plan = buildPlan(topPriority, classesToday, missedTop);
  const insight = buildInsight(classesToday.length, topPriority.length, dueToday);

  const sections = [
    "TODAY",
    bullets([
      `${Math.min(classesToday.length, 3)} class(es) today`,
      nextClass
        ? `Next class: ${truncateTitle(nextClass.title)} (${formatTime(nextClass.start)})`
        : "Next class: none"
    ]),
    "DEADLINES",
    bullets([`Due today: ${dueToday}`, `Due tomorrow: ${dueTomorrow}`]),
    "TOP PRIORITY",
    bullets(
      topPriority.length > 0
        ? topPriority.map(
            (item) =>
              `${truncateTitle(item.title)} (${formatTimeLeft(item.hoursRemaining)})`
          )
        : ["No urgent tasks in next 24h"]
    ),
    "MISSED",
    bullets(
      missedTop.length > 0
        ? missedTop.map((lecture) => truncateTitle(lecture.title))
        : ["None"]
    ),
    "NEXT ACTION",
    bullets([nextAction]),
    "PLAN",
    bullets(plan),
    "INSIGHT",
    bullets([insight])
  ];

  return sections.join("\n");
}
