import { callMcpTool } from "../mcp/index.js";
import { calculatePriority } from "./priorityEngine.js";
import { normalizeData } from "./dataFormatter.js";
import { loadNewtonContext, resolveSubjectFromQuery } from "./newtonContext.js";
import { UI } from "../ui/logger.js";

function toIsoDateTime(ts) {
  if (!ts) return "N/A";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function formatSection(title, lines) {
  const safeLines = lines.length > 0 ? lines : ["No data available."];
  return `${title}:\n${safeLines.map((line) => `* ${line}`).join("\n")}`;
}

function mapAssignmentItem(item) {
  return {
    title: item?.title || "Untitled assignment",
    course: item?.subject_name || "Unknown subject",
    dueAt: item?.end_timestamp || item?.dueAt || null,
    url: item?.url || null
  };
}

function mapLectureItem(item) {
  return {
    title: item?.title || "Lecture",
    course: item?.subject_name || "Unknown subject",
    start: item?.start_timestamp || item?.start || null,
    end: item?.end_timestamp || item?.end || null,
    is_attended: item?.is_attended,
    url: item?.url || null
  };
}

function mapCalendarItem(item) {
  return {
    title: item?.title || "Class",
    course: item?.subject_name || item?.type || "Unknown",
    start: item?.start_timestamp || item?.start || null,
    end: item?.end_timestamp || item?.end || null,
    type: item?.type || null
  };
}

export async function runAttendanceWorkflow(query) {
  UI.agent("Workflow: attendance");
  const context = await loadNewtonContext();
  const subject = resolveSubjectFromQuery(query, context.subjectByName);

  const overview = context.tools.getCourseOverview
    ? await callMcpTool(context.tools.getCourseOverview, { course_hash: context.primaryCourseHash })
    : null;

  const subjectProgress = subject && context.tools.getSubjectProgress
    ? await callMcpTool(context.tools.getSubjectProgress, {
        course_hash: subject.courseHash || context.primaryCourseHash,
        subject_hash: subject.hash
      })
    : null;

  const recentLecturesRaw = context.tools.getRecentLectures
    ? await callMcpTool(context.tools.getRecentLectures, { course_hash: context.primaryCourseHash, limit: 12 })
    : { lectures: [] };

  const lectures = Array.isArray(recentLecturesRaw?.lectures)
    ? recentLecturesRaw.lectures.map(mapLectureItem)
    : [];

  const missed = lectures.filter((lecture) => lecture.is_attended === false);

  const todayLines = [
    `Overall attendance: ${overview?.performance?.lectures_attended ?? "N/A"} / ${overview?.performance?.total_lectures ?? "N/A"}`,
    subjectProgress
      ? `Subject attendance (${subject?.name}): ${subjectProgress?.performance?.lectures_attended ?? "N/A"} / ${subjectProgress?.performance?.total_lectures ?? "N/A"}`
      : "Subject attendance: ask for a specific subject for deeper breakdown"
  ];

  const priorityLines = missed.slice(0, 3).map((lecture) => `${lecture.course}: ${lecture.title} (${toIsoDateTime(lecture.start)})`);
  if (priorityLines.length === 0) {
    priorityLines.push("No recently missed lectures detected.");
  }

  const planLines = [
    "Watch recording or review notes for missed lectures first.",
    "Ask: 'show attendance subject-wise' for full breakdown.",
    "Ask: 'show recent lectures with recordings' to recover quickly."
  ];

  const warningLines = missed.length > 0
    ? [`Missed lectures: ${missed.length}`]
    : ["No attendance warning right now."];

  return [
    formatSection("TODAY", todayLines),
    formatSection("PRIORITY", priorityLines),
    formatSection("PLAN", planLines),
    formatSection("WARNING", warningLines)
  ].join("\n\n");
}

export async function runDailyPlanWorkflow() {
  UI.agent("Workflow: dailyPlan");
  const context = await loadNewtonContext();

  const [calendarRaw, assignmentsRaw, recentLecturesRaw] = await Promise.all([
    context.tools.getCalendar
      ? callMcpTool(context.tools.getCalendar, { course_hash: context.primaryCourseHash, number_of_days: 1 })
      : Promise.resolve({ events: [] }),
    context.tools.getAssignments
      ? callMcpTool(context.tools.getAssignments, { course_hash: context.primaryCourseHash, include_contests: true, limit: 25 })
      : Promise.resolve({ assignments: [], contests: [] }),
    context.tools.getRecentLectures
      ? callMcpTool(context.tools.getRecentLectures, { course_hash: context.primaryCourseHash, limit: 10 })
      : Promise.resolve({ lectures: [] })
  ]);

  const classes = (calendarRaw?.events || []).map(mapCalendarItem);
  const assignments = [...(assignmentsRaw?.assignments || []), ...(assignmentsRaw?.contests || [])].map(mapAssignmentItem);
  const lectures = (recentLecturesRaw?.lectures || []).map(mapLectureItem);

  const prioritized = calculatePriority(assignments);
  const normalized = normalizeData({ calendar: classes, assignments: prioritized, lectures });

  const todayLines = [
    ...normalized.todayClasses.slice(0, 4).map((item) => `${item.course}: ${item.title} (${toIsoDateTime(item.start)})`),
    `${normalized.urgentAssignments.length} urgent assignment(s) in the next 24h`
  ];

  const priorityLines = prioritized.slice(0, 4).map((item) => {
    const hours = typeof item.hoursRemaining === "number" ? `${Math.round(item.hoursRemaining)}h left` : "deadline unknown";
    return `${item.course}: ${item.title} (${hours}, score=${item.priorityScore})`;
  });

  const planLines = [
    "Start with highest priority item first.",
    "Complete one assignment block before the next class slot.",
    "Use lecture recordings for missed topics after class hours."
  ];

  const warningLines = [
    ...normalized.missedLectures.slice(0, 3).map((item) => `Missed: ${item.course} - ${item.title}`)
  ];

  if (warningLines.length === 0) {
    warningLines.push("No missed lecture warnings.");
  }

  return [
    formatSection("TODAY", todayLines),
    formatSection("PRIORITY", priorityLines),
    formatSection("PLAN", planLines),
    formatSection("WARNING", warningLines)
  ].join("\n\n");
}

export async function runPerformanceWorkflow(query) {
  UI.agent("Workflow: performance");
  const context = await loadNewtonContext();
  const subject = resolveSubjectFromQuery(query, context.subjectByName);

  const overview = context.tools.getCourseOverview
    ? await callMcpTool(context.tools.getCourseOverview, { course_hash: context.primaryCourseHash })
    : null;

  const leaderboard = context.tools.getLeaderboard
    ? await callMcpTool(context.tools.getLeaderboard, { course_hash: context.primaryCourseHash, period: "weekly", limit: 10 })
    : { entries: [] };

  const subjectAssessments = subject && context.tools.getAssessments
    ? await callMcpTool(context.tools.getAssessments, {
        course_hash: subject.courseHash || context.primaryCourseHash,
        subject_hash: subject.hash
      })
    : { assessments: [] };

  const arenaStats = context.tools.getArenaStats
    ? await callMcpTool(context.tools.getArenaStats, { course_hash: context.primaryCourseHash })
    : null;

  const currentUser = (leaderboard?.entries || []).find((entry) => entry?.is_current_user);

  const todayLines = [
    `XP: ${overview?.xp?.earned ?? overview?.xp ?? "N/A"}`,
    `Leaderboard rank (weekly): ${currentUser?.rank ?? "N/A"}`,
    `Assessments completed: ${overview?.performance?.completed_assessments ?? "N/A"} / ${overview?.performance?.total_assessments ?? "N/A"}`
  ];

  const priorityLines = [
    subject
      ? `Focus subject: ${subject.name} (${(subjectAssessments?.assessments || []).length} assessment records)`
      : "Ask for a subject name for precise assessment analysis.",
    `Assignment completion: ${overview?.performance?.assignment_questions_completed ?? "N/A"} / ${overview?.performance?.total_assignment_questions ?? "N/A"}`
  ];

  const planLines = [
    "Pick one weak subject area and solve 2 targeted tasks today.",
    "Review latest wrong assessments and revise those concepts.",
    "Track weekly rank trend every evening."
  ];

  const warningLines = [];
  if (arenaStats && Number(arenaStats?.total_questions || 0) === 0) {
    warningLines.push("Arena appears empty/unavailable for this course context.");
  }
  if (warningLines.length === 0) {
    warningLines.push("No major performance warnings.");
  }

  return [
    formatSection("TODAY", todayLines),
    formatSection("PRIORITY", priorityLines),
    formatSection("PLAN", planLines),
    formatSection("WARNING", warningLines)
  ].join("\n\n");
}

export async function runUpcomingWorkflow(query) {
  UI.agent("Workflow: upcoming");
  const context = await loadNewtonContext();
  const days = /tomorrow/.test(String(query || "").toLowerCase()) ? 2 : 7;

  const upcomingRaw = context.tools.getUpcomingSchedule
    ? await callMcpTool(context.tools.getUpcomingSchedule, {
        course_hash: context.primaryCourseHash,
        days
      })
    : { upcoming_lectures: [] };

  const lectures = (upcomingRaw?.upcoming_lectures || []).map((item) => ({
    title: item?.title || "Lecture",
    subject: item?.subject_name || "Unknown subject",
    start: item?.start_timestamp || null
  }));

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const tomorrowLectures = lectures.filter((lecture) => {
    const date = new Date(lecture.start || "");
    return (
      !Number.isNaN(date.getTime()) &&
      date.getFullYear() === tomorrow.getFullYear() &&
      date.getMonth() === tomorrow.getMonth() &&
      date.getDate() === tomorrow.getDate()
    );
  });

  const list = tomorrowLectures.length > 0 ? tomorrowLectures : lectures;

  const todayLines = [
    `${list.length} upcoming lecture(s) found`,
    list[0]
      ? `${list[0].subject}: ${list[0].title}`
      : "No upcoming lectures found"
  ];

  const priorityLines = list.slice(0, 3).map((item) => `${item.subject}: ${item.title}`);
  if (priorityLines.length === 0) priorityLines.push("No lecture priorities right now.");

  const planLines = [
    "Review the next lecture topic before class.",
    "Keep one short revision block after lecture.",
    "Ask for assignments due with /assignments."
  ];

  const warningLines = [
    tomorrowLectures.length > 0
      ? `You have ${tomorrowLectures.length} lecture(s) tomorrow.`
      : "No tomorrow-specific lectures found in upcoming window."
  ];

  return [
    formatSection("TODAY", todayLines),
    formatSection("PRIORITY", priorityLines),
    formatSection("PLAN", planLines),
    formatSection("WARNING", warningLines)
  ].join("\n\n");
}
