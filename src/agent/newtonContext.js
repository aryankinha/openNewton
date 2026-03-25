import { callMcpTool, getAvailableToolNames } from "../mcp/index.js";

const TOOL_PATTERNS = {
  listCourses: [/list_courses$/i],
  getCourseOverview: [/get_course_overview$/i],
  getSubjectProgress: [/get_subject_progress$/i],
  getAssignments: [/get_assignments$/i],
  getCalendar: [/get_calendar$/i],
  getUpcomingSchedule: [/get_upcoming_schedule$/i],
  getRecentLectures: [/get_recent_lectures$/i],
  getAssessments: [/get_assessments$/i],
  getLeaderboard: [/get_leaderboard$/i],
  getArenaStats: [/get_arena_stats$/i],
  getArenaFilters: [/get_arena_filters$/i]
};

export function resolveTool(alias) {
  const names = getAvailableToolNames();
  const patterns = TOOL_PATTERNS[alias] || [];
  return names.find((name) => patterns.some((pattern) => pattern.test(name))) || null;
}

function getSubjectsFromCourses(courses = []) {
  const subjects = [];
  for (const course of courses) {
    const raw = course?.subjects || course?.subjects_list || [];
    if (!Array.isArray(raw)) continue;

    for (const subject of raw) {
      const subjectName = subject?.name || subject?.subject_name || subject?.title || null;
      const subjectHash = subject?.hash || subject?.subject_hash || null;
      if (subjectName && subjectHash) {
        subjects.push({ name: subjectName, hash: subjectHash, courseHash: course.hash || course.course_hash });
      }
    }
  }
  return subjects;
}

export async function loadNewtonContext() {
  const listCoursesTool = resolveTool("listCourses");
  if (!listCoursesTool) {
    throw new Error("Newton tool list_courses is not available.");
  }

  const result = await callMcpTool(listCoursesTool, {});
  const courses = result?.courses || [];
  const primaryCourseHash = result?.primary_course_hash || courses?.[0]?.hash || courses?.[0]?.course_hash || null;
  const subjects = getSubjectsFromCourses(courses);

  const subjectByName = new Map();
  for (const subject of subjects) {
    subjectByName.set(String(subject.name).toLowerCase(), subject);
  }

  return {
    tools: {
      listCourses: listCoursesTool,
      getCourseOverview: resolveTool("getCourseOverview"),
      getSubjectProgress: resolveTool("getSubjectProgress"),
      getAssignments: resolveTool("getAssignments"),
      getCalendar: resolveTool("getCalendar"),
      getUpcomingSchedule: resolveTool("getUpcomingSchedule"),
      getRecentLectures: resolveTool("getRecentLectures"),
      getAssessments: resolveTool("getAssessments"),
      getLeaderboard: resolveTool("getLeaderboard"),
      getArenaStats: resolveTool("getArenaStats"),
      getArenaFilters: resolveTool("getArenaFilters")
    },
    courses,
    primaryCourseHash,
    subjectByName
  };
}

export function resolveSubjectFromQuery(query, subjectByName) {
  const text = String(query || "").toLowerCase();
  for (const [name, subject] of subjectByName.entries()) {
    if (text.includes(name.toLowerCase())) {
      return subject;
    }
  }
  return null;
}
