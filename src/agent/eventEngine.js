function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hoursUntil(value) {
  const date = toDate(value);
  if (!date) return null;
  return (date.getTime() - Date.now()) / (1000 * 60 * 60);
}

export function detectUrgentAssignments(assignments = []) {
  return assignments
    .map((item) => ({ ...item, hoursRemaining: hoursUntil(item?.dueAt || item?.end_timestamp) }))
    .filter((item) => typeof item.hoursRemaining === "number" && item.hoursRemaining > 0 && item.hoursRemaining < 6);
}

export function detectUpcomingDeadlines(assignments = []) {
  return assignments
    .map((item) => ({ ...item, hoursRemaining: hoursUntil(item?.dueAt || item?.end_timestamp) }))
    .filter((item) => typeof item.hoursRemaining === "number" && item.hoursRemaining >= 6 && item.hoursRemaining < 24);
}

export function detectMissedLectures(lectures = []) {
  return lectures.filter((lecture) => lecture?.is_attended === false);
}

export function detectHeavyDay(calendar = [], assignments = []) {
  const classCount = calendar.length;
  const taskCount = assignments.length;

  const isHeavy = classCount >= 4 && taskCount >= 2;
  return {
    isHeavy,
    classCount,
    taskCount
  };
}
