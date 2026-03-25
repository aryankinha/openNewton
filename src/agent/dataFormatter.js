function isSameLocalDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeData({ calendar = [], assignments = [], lectures = [] }) {
  const today = new Date();

  const todayClasses = calendar.filter((item) => {
    const startDate = toDate(item?.start);
    if (!startDate) return true;
    return isSameLocalDate(startDate, today);
  });

  const urgentAssignments = assignments.filter((item) => {
    if (typeof item?.priorityScore === "number") {
      return item.priorityScore > 0;
    }

    const dueDate = toDate(item?.dueAt || item?.deadline || item?.due_date);
    if (!dueDate) return false;
    const hoursRemaining = (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60);
    return hoursRemaining < 24;
  });

  const missedLectures = lectures.filter((lecture) => lecture?.is_attended === false);

  return {
    todayClasses,
    urgentAssignments,
    missedLectures
  };
}
