import figlet from "figlet";
import gradient from "gradient-string";
import { UI } from "./logger.js";

function normalizeBullets(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trimEnd());

  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("*")) return `- ${trimmed.slice(1).trim()}`;
    if (/^\d+\./.test(trimmed)) return `- ${trimmed.replace(/^\d+\.\s*/, "")}`;
    return line;
  });
}

function capSectionBullets(lines, header, limit) {
  const out = [...lines];
  const idx = out.findIndex((line) => line.trim().toUpperCase() === `${header}:` || line.trim().toUpperCase() === header);
  if (idx === -1) return out;

  let i = idx + 1;
  const bulletIndexes = [];
  while (i < out.length) {
    const t = out[i].trim();
    if (!t) {
      i += 1;
      continue;
    }
    const upper = t.toUpperCase();
    if (["TODAY:", "PRIORITY:", "PLAN:", "WARNING:", "DEADLINES", "TOP PRIORITY", "MISSED", "NEXT ACTION", "INSIGHT"].includes(upper) || ["TODAY", "PRIORITY", "PLAN", "WARNING", "DEADLINES", "TOP PRIORITY", "MISSED", "NEXT ACTION", "INSIGHT"].includes(upper)) {
      break;
    }
    if (t.startsWith("-") || t.startsWith("*")) {
      bulletIndexes.push(i);
    }
    i += 1;
  }

  if (bulletIndexes.length <= limit) return out;
  const toDrop = bulletIndexes.slice(limit);
  for (const dropIndex of toDrop.reverse()) {
    out.splice(dropIndex, 1);
  }
  return out;
}

export function showLogo() {
  const ascii = figlet.textSync("Newton Agent", {
    font: "Standard",
    horizontalLayout: "default",
    verticalLayout: "default"
  });

  const subtle = gradient(["#8ec5fc", "#3f5efb"]);
  console.log(subtle(ascii));
}

export function showStartupMessage() {
  UI.printBoxed("Newton Agent Ready", {
    title: "Startup",
    borderColor: "blue"
  });
  console.log(UI.separator());
}

export function showAuthRequired(url, code) {
  const lines = ["Authentication required."];
  if (url) lines.push(`Go to: ${url}`);
  if (code) lines.push(`Enter code: ${code}`);

  UI.printBoxed(lines.join("\n"), {
    title: "Authentication",
    borderColor: "yellow"
  });
}

export function showErrorBox(message) {
  UI.printBoxed(String(message || "Unknown error"), {
    title: "Error",
    borderColor: "red"
  });
}

export function formatAgentResponse(raw) {
  let lines = normalizeBullets(raw);
  lines = capSectionBullets(lines, "PLAN", 3);
  lines = capSectionBullets(lines, "TOP PRIORITY", 3);
  lines = capSectionBullets(lines, "MISSED", 2);

  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (["TODAY:", "PRIORITY:", "PLAN:", "WARNING:", "DEADLINES", "TOP PRIORITY", "MISSED", "NEXT ACTION", "INSIGHT"].includes(trimmed.toUpperCase()) || ["TODAY", "PRIORITY", "PLAN", "WARNING", "DEADLINES", "TOP PRIORITY", "MISSED", "NEXT ACTION", "INSIGHT"].includes(trimmed.toUpperCase())) {
      out.push("");
      out.push(UI.sectionHeader(trimmed.replace(":", "")));
      out.push(UI.separator());
      continue;
    }

    out.push(line);
  }

  return out.join("\n").trim();
}
