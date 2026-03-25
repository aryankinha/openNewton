export function detectIntent(query) {
  const text = String(query || "").toLowerCase();

  if (/(tom+o?r+r?o?w+|tommorow|upcoming|next lecture|next class|next lectures|next classes)/.test(text)) {
    return "upcoming";
  }

  if (/attendance|attend|presence|missed lecture/.test(text)) {
    return "attendance";
  }

  if (/today|schedule|calendar|assignment|deadline|plan|structured plan/.test(text)) {
    return "dailyPlan";
  }

  if (/performance|progress|rank|leaderboard|xp|assessment|score/.test(text)) {
    return "performance";
  }

  return "general";
}
