function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function calculatePriority(assignments = []) {
  const now = Date.now();

  const ranked = assignments.map((assignment) => {
    const dueValue = assignment?.dueAt || assignment?.deadline || assignment?.due_date || null;
    const dueDate = toDate(dueValue);
    const hoursRemaining = dueDate ? (dueDate.getTime() - now) / (1000 * 60 * 60) : null;

    let priorityScore = 0;
    if (hoursRemaining !== null && hoursRemaining < 24) priorityScore += 10;
    if (hoursRemaining !== null && hoursRemaining < 6) priorityScore += 20;

    return {
      ...assignment,
      dueAt: dueValue,
      hoursRemaining,
      priorityScore
    };
  });

  return ranked.sort((a, b) => b.priorityScore - a.priorityScore);
}
