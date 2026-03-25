export function buildMockMonitoringSnapshot() {
  const now = Date.now();
  const inHours = (h) => new Date(now + h * 60 * 60 * 1000).toISOString();

  return {
    assignments: [
      {
        id: "mock-assignment-urgent",
        title: "DVA Mini Project",
        subject: "DVA - B",
        dueAt: inHours(3),
        url: "https://newton.school/mock/assignments/urgent"
      },
      {
        id: "mock-assignment-upcoming",
        title: "GenAI Reflection",
        subject: "GenAI - B",
        dueAt: inHours(18),
        url: "https://newton.school/mock/assignments/upcoming"
      }
    ],
    calendar: [
      { id: "mock-class-1", title: "DVA Lecture", subject: "DVA - B", start: inHours(1), end: inHours(2.5) },
      { id: "mock-class-2", title: "DM Lab", subject: "DM - B", start: inHours(3), end: inHours(4.5) },
      { id: "mock-class-3", title: "GenAI Slot", subject: "GenAI - B", start: inHours(5), end: inHours(6.5) },
      { id: "mock-class-4", title: "SD Practice", subject: "SD - B", start: inHours(7), end: inHours(8.5) }
    ],
    lectures: [
      {
        id: "mock-lecture-missed",
        title: "Ring Theory 2",
        subject: "DM - B",
        is_attended: false,
        start: inHours(-5),
        end: inHours(-3.5),
        url: "https://newton.school/mock/lectures/missed"
      }
    ]
  };
}
