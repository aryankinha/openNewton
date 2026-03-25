import { callMcpTool } from "../mcp/index.js";
import { loadNewtonContext } from "./newtonContext.js";

function mapAssignmentItem(item) {
  return {
    id: item?.hash || `${item?.title || "assignment"}-${item?.end_timestamp || "na"}`,
    title: item?.title || "Untitled assignment",
    subject: item?.subject_name || "Unknown subject",
    dueAt: item?.end_timestamp || item?.dueAt || null,
    url: item?.url || null
  };
}

function mapCalendarItem(item) {
  return {
    id: item?.hash || `${item?.title || "class"}-${item?.start_timestamp || "na"}`,
    title: item?.title || "Class",
    subject: item?.subject_name || item?.type || "Unknown",
    start: item?.start_timestamp || item?.start || null,
    end: item?.end_timestamp || item?.end || null
  };
}

function mapLectureItem(item) {
  return {
    id: item?.lecture_hash || item?.hash || `${item?.title || "lecture"}-${item?.start_timestamp || "na"}`,
    title: item?.title || "Lecture",
    subject: item?.subject_name || "Unknown subject",
    is_attended: item?.is_attended,
    start: item?.start_timestamp || item?.start || null,
    end: item?.end_timestamp || item?.end || null,
    url: item?.url || null
  };
}

export async function fetchMonitoringSnapshot() {
  const context = await loadNewtonContext();

  const [assignmentsRaw, calendarRaw, lecturesRaw] = await Promise.all([
    context.tools.getAssignments
      ? callMcpTool(context.tools.getAssignments, {
          course_hash: context.primaryCourseHash,
          include_contests: true,
          limit: 50
        })
      : Promise.resolve({ assignments: [], contests: [] }),
    context.tools.getCalendar
      ? callMcpTool(context.tools.getCalendar, {
          course_hash: context.primaryCourseHash,
          number_of_days: 1
        })
      : Promise.resolve({ events: [] }),
    context.tools.getRecentLectures
      ? callMcpTool(context.tools.getRecentLectures, {
          course_hash: context.primaryCourseHash,
          limit: 20
        })
      : Promise.resolve({ lectures: [] })
  ]);

  const assignments = [
    ...(assignmentsRaw?.assignments || []),
    ...(assignmentsRaw?.contests || [])
  ].map(mapAssignmentItem);

  const calendar = (calendarRaw?.events || []).map(mapCalendarItem);
  const lectures = (lecturesRaw?.lectures || []).map(mapLectureItem);

  return {
    assignments,
    calendar,
    lectures
  };
}
