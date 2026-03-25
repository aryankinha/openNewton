import { callLLM } from "../llm/index.js";
import { executeTool } from "./executeTool.js";
import { AGENT_TOOLS, getAgentTools } from "./tools.js";
import { normalizeData } from "./dataFormatter.js";
import { calculatePriority } from "./priorityEngine.js";
import { detectIntent } from "./intents.js";
import {
  runAttendanceWorkflow,
  runDailyPlanWorkflow,
  runPerformanceWorkflow,
  runUpcomingWorkflow
} from "./newtonWorkflows.js";

function buildSystemPrompt(tools) {
  const toolLines = tools.length
    ? tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n")
    : "- (no tools loaded)";

  return `You are an intelligent academic assistant.
You have access to tools:
${toolLines}

Rules:
- Use tools when needed
- You can call multiple tools
- Combine results before answering
- Always give actionable advice
- Keep responses concise and clean
- Avoid generic introductions like "I am an academic assistant"
- For greeting-only user inputs, reply in one short line and immediately offer options
- For attendance, marks, progress, or performance questions:
  - Prefer attendance/progress-related tools first
  - If one tool is insufficient, call additional relevant tools
  - Do not claim data is unavailable until you have attempted relevant tools
- Always respond in this exact section format:
TODAY:
* Classes
* Deadlines

PRIORITY:
* Ordered tasks

PLAN:
* Actionable steps

WARNING:
* Optional (missed lectures, urgent alerts)

When you need a tool, respond ONLY in strict JSON:
{"toolCall":{"name":"<toolName>","arguments":{}}}

When you are done, respond with normal text only.`;
}

const SYSTEM_PROMPT = buildSystemPrompt(getAgentTools());

function isGreetingOnlyInput(input) {
  const value = String(input || "").trim().toLowerCase();
  return /^(hi|hello|hey|yo|hola|hii|hiii|good morning|good afternoon|good evening)$/.test(value);
}

function normalizeToolCall(payload) {
  const call = payload?.toolCall;
  if (!call?.name || typeof call.name !== "string") {
    return null;
  }

  return {
    name: call.name,
    arguments: typeof call.arguments === "object" && call.arguments !== null ? call.arguments : {}
  };
}

function extractFirstJsonObject(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function buildStructuredContext(dataState) {
  const prioritizedAssignments = calculatePriority(dataState.assignments || []);
  const normalized = normalizeData({
    calendar: dataState.calendar || [],
    assignments: prioritizedAssignments,
    lectures: dataState.lectures || []
  });

  return {
    date: new Date().toISOString().slice(0, 10),
    todayClasses: normalized.todayClasses,
    urgentAssignments: normalized.urgentAssignments,
    missedLectures: normalized.missedLectures,
    prioritizedAssignments
  };
}

function inferDataBucketFromToolName(toolName) {
  const value = String(toolName || "").toLowerCase();
  if (value.includes("calendar") || value.includes("schedule") || value.includes("class")) {
    return "calendar";
  }
  if (value.includes("assignment") || value.includes("homework") || value.includes("deadline")) {
    return "assignments";
  }
  if (value.includes("lecture")) {
    return "lectures";
  }
  return null;
}

function getRequiredToolsForQuery(query, tools) {
  const value = String(query || "").toLowerCase();

  if (/attendance|attend|presence/.test(value)) {
    return tools
      .map((tool) => tool.name)
      .filter((name) => /attendance|attend|presence/.test(name.toLowerCase()));
  }

  return [];
}

export async function runAgent(userInput, options = {}) {
  const maxSteps = options.maxSteps ?? 6;

  if (isGreetingOnlyInput(userInput)) {
    return "Hi. Pick one: today's schedule, due assignments, or lecture recap.";
  }

  const activeTools = getAgentTools();
  const intent = detectIntent(userInput);

  try {
    if (intent === "attendance") {
      return await runAttendanceWorkflow(userInput);
    }

    if (intent === "dailyPlan") {
      return await runDailyPlanWorkflow();
    }

    if (intent === "performance") {
      return await runPerformanceWorkflow(userInput);
    }

    if (intent === "upcoming") {
      return await runUpcomingWorkflow(userInput);
    }
  } catch {
    // Fallback to the generic agentic loop if deterministic workflow dependencies fail.
  }

  const requiredTools = getRequiredToolsForQuery(userInput, activeTools);
  const usedTools = new Set();
  const messages = [
    { role: "system", content: buildSystemPrompt(activeTools) },
    { role: "user", content: userInput }
  ];

  const dataState = {
    calendar: [],
    assignments: [],
    lectures: [],
    toolResults: {}
  };

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await callLLM(messages);

    // If a provider later adds native tool response metadata, prefer it.
    const directToolCall = normalizeToolCall(response);
    if (directToolCall) {
      usedTools.add(directToolCall.name);
      const toolResult = await executeTool(directToolCall);
      const dataKey = inferDataBucketFromToolName(directToolCall.name);
      if (dataKey) {
        dataState[dataKey] = Array.isArray(toolResult) ? toolResult : [];
      }
      dataState.toolResults[directToolCall.name] = toolResult;

      const structuredData = buildStructuredContext(dataState);
      messages.push({
        role: "assistant",
        content: JSON.stringify({ toolCall: directToolCall })
      });
      messages.push({
        role: "user",
        content:
          `Tool result from ${directToolCall.name}: ${JSON.stringify(toolResult)}\n` +
          `Structured academic data snapshot: ${JSON.stringify(structuredData)}`
      });
      continue;
    }

    const content = response?.content || "";
    const parsed = extractFirstJsonObject(content);
    const parsedToolCall = normalizeToolCall(parsed);

    if (parsedToolCall) {
      usedTools.add(parsedToolCall.name);
      const toolResult = await executeTool(parsedToolCall);
      const dataKey = inferDataBucketFromToolName(parsedToolCall.name);
      if (dataKey) {
        dataState[dataKey] = Array.isArray(toolResult) ? toolResult : [];
      }
      dataState.toolResults[parsedToolCall.name] = toolResult;

      const structuredData = buildStructuredContext(dataState);
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content:
          `Tool result from ${parsedToolCall.name}: ${JSON.stringify(toolResult)}\n` +
          `Structured academic data snapshot: ${JSON.stringify(structuredData)}`
      });
      continue;
    }

    const missingRequiredToolCall =
      requiredTools.length > 0 && !requiredTools.some((toolName) => usedTools.has(toolName));

    if (missingRequiredToolCall && step < maxSteps - 1) {
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content:
          "Before finalizing, call an attendance-related tool to answer this user request accurately. " +
          `Use one of: ${requiredTools.join(", ")}`
      });
      continue;
    }

    return content.trim() || "I could not generate a response.";
  }

  return "I reached the tool-call limit for this request. Please ask a narrower follow-up question.";
}

export { SYSTEM_PROMPT, AGENT_TOOLS };
