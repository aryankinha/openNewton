import { runAgent } from "../agent/agentEngine.js";
import { UI } from "../ui/logger.js";
import { sendTelegram } from "./telegram.js";

const TELEGRAM_MAX_TEXT = 3500;
const TELEGRAM_SECTION_LIMITS = {
  TODAY: 3,
  PRIORITY: 3,
  PLAN: 2,
  WARNING: 2
};

const TELEGRAM_SECTION_EMOJI = {
  TODAY: "📅",
  PRIORITY: "🎯",
  PLAN: "🧭",
  WARNING: "⚠️"
};

function isSmallTalkPrompt(text) {
  const value = String(text || "").trim().toLowerCase();
  return /^(hi|hello|hey|yo|how are you|how r u|how are u|how you doing|sup)$/.test(value);
}

function buildSmallTalkReply() {
  return "I am active and ready. Ask me about today, assignments, attendance, or tomorrow lectures.";
}

function compactTelegramResponse(raw) {
  const lines = String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      if (line.startsWith("*")) return `- ${line.slice(1).trim()}`;
      if (/^\d+\./.test(line)) return `- ${line.replace(/^\d+\.\s*/, "")}`;
      return line;
    });

  const sections = {
    TODAY: [],
    PRIORITY: [],
    PLAN: [],
    WARNING: []
  };

  let currentSection = "";

  for (const line of lines) {
    if (!line) continue;

    const normalizedHeader = line.replace(/:$/, "").toUpperCase();
    if (sections[normalizedHeader]) {
      currentSection = normalizedHeader;
      continue;
    }

    if (!currentSection) continue;

    const bulletLine = line.startsWith("-") ? line.slice(1).trim() : line;
    const cleaned = bulletLine
      .replace(/\s+/g, " ")
      .replace(/\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\)/g, "($2)")
      .replace(/\(-/g, "(")
      .replace(/,\s*score\s*=\s*\d+/gi, "")
      .trim();

    if (!cleaned) continue;
    sections[currentSection].push(cleaned);
  }

  const output = [];
  const orderedSections = ["TODAY", "PRIORITY", "PLAN", "WARNING"];

  for (const key of orderedSections) {
    const items = sections[key].slice(0, TELEGRAM_SECTION_LIMITS[key]);
    if (!items.length) continue;

    output.push(`${TELEGRAM_SECTION_EMOJI[key]} ${key}`);
    for (const item of items) {
      const clipped = item.length > 95 ? `${item.slice(0, 92)}...` : item;
      output.push(`• ${clipped}`);
    }
    output.push("");
  }

  if (output.length > 0) {
    return output.join("\n").trim();
  }

  const fallback = lines
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => (line.startsWith("-") ? `• ${line.slice(1).trim()}` : line));

  return fallback.join("\n").trim();
}

function normalizePromptForAgent(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return "";

  if (/(tom+o?r+r?o?w+|tommorow|next lecture|next class)/i.test(text)) {
    return "What lectures do I have tomorrow?";
  }

  return text;
}

async function sendTelegramSafe(message, options) {
  const compact = compactTelegramResponse(message);
  const text = String(compact || "").trim() || "I could not generate a response.";
  const chunks = [];

  for (let i = 0; i < text.length; i += TELEGRAM_MAX_TEXT) {
    chunks.push(text.slice(i, i + TELEGRAM_MAX_TEXT));
  }

  for (const chunk of chunks) {
    await sendTelegram(chunk, options);
  }
}

function buildCommandPrompt(text) {
  const cmd = text.split(" ")[0].toLowerCase();
  if (cmd === "/start") {
    return "Welcome! Ask me about today, assignments, attendance, or performance.";
  }

  if (cmd === "/help") {
    return "Available commands: /today /assignments /attendance or ask in natural language.";
  }

  if (cmd === "/today") {
    return "What should I do today based on classes, assignments, and recent lectures?";
  }

  if (cmd === "/assignments") {
    return "Show top assignments and deadlines for today and tomorrow.";
  }

  if (cmd === "/attendance") {
    return "Show my attendance summary and missed lectures.";
  }

  if (cmd === "/tomorrow") {
    return "What lectures do I have tomorrow?";
  }

  return null;
}

function extractStartQuery(text) {
  const value = String(text || "").trim();
  if (!value.toLowerCase().startsWith("/start")) return "";
  return value.slice(6).trim();
}

async function fetchUpdates(config, offset) {
  const token = config.telegram.botToken;
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data?.description || "Telegram getUpdates failed");
  }

  return data.result || [];
}

export function startTelegramBot(config) {
  let stopped = false;
  let offset = 0;
  const allowedChat = String(config.telegram.chatId);
  const notifiedUnknownChats = new Set();

  UI.notify("Telegram listener started");

  const loop = async () => {
    while (!stopped) {
      try {
        const updates = await fetchUpdates(config, offset);

        for (const update of updates) {
          offset = Math.max(offset, Number(update.update_id || 0) + 1);

          const message = update?.message;
          if (!message?.text) continue;

          const chatId = String(message?.chat?.id || "");
          if (chatId !== allowedChat) {
            const shouldNotifyMismatch = /^\/(start|help)/i.test(String(message.text || ""));
            if (shouldNotifyMismatch && !notifiedUnknownChats.has(chatId)) {
              notifiedUnknownChats.add(chatId);
              try {
                await sendTelegramSafe(
                  `This bot is configured for chat ID ${allowedChat}. Run 'newton-agent init' and update telegram.chatId to use this chat.`,
                  { config, chatId }
                );
              } catch {
                // Ignore mismatch notification failures.
              }
            }
            continue;
          }

          const text = message.text.trim();
          const commandReply = buildCommandPrompt(text);
          const startQuery = extractStartQuery(text);

          if (text.toLowerCase() === "/start") {
            await sendTelegramSafe("Newton Agent is active. You can now send normal messages without /start. Use /help for commands.", {
              config,
              chatId
            });
            continue;
          }

          if (startQuery) {
            try {
              UI.notify(`Telegram message received: ${startQuery.slice(0, 40)}`);
              const normalizedPrompt = normalizePromptForAgent(startQuery);
              const reply = isSmallTalkPrompt(normalizedPrompt)
                ? buildSmallTalkReply()
                : await runAgent(normalizedPrompt);
              await sendTelegramSafe(reply, { config, chatId });
            } catch (error) {
              UI.error(`Telegram message handling failed: ${error.message}`);
              await sendTelegramSafe("I had trouble processing that. Try: 'today plan', '/attendance', or 'what lectures tomorrow'.", {
                config,
                chatId
              });
            }
            continue;
          }

          if (text.toLowerCase() === "/help") {
            await sendTelegramSafe(
              "Commands:\n- /today\n- /assignments\n- /attendance\n- /tomorrow\nOr ask naturally, e.g. 'what lectures do I have tomorrow?'",
              { config, chatId }
            );
            continue;
          }

          const userPrompt = commandReply || text;
          try {
            UI.notify(`Telegram message received: ${text.slice(0, 40)}`);
            const normalizedPrompt = normalizePromptForAgent(userPrompt);
            const reply = isSmallTalkPrompt(normalizedPrompt)
              ? buildSmallTalkReply()
              : await runAgent(normalizedPrompt);
            await sendTelegramSafe(reply, { config, chatId });
          } catch (error) {
            UI.error(`Telegram message handling failed: ${error.message}`);
            await sendTelegramSafe("I had trouble processing that. Try: 'today plan', '/attendance', or 'what lectures tomorrow'.", {
              config,
              chatId
            });
          }
        }
      } catch (error) {
        UI.error(`Telegram listener error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  };

  void loop();

  return {
    stop() {
      stopped = true;
      UI.notify("Telegram listener stopped");
    }
  };
}
