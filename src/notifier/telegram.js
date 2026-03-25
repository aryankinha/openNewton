import { loadConfig, validateConfig } from "../config/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendTelegram(message, options = {}) {
  const config = options.config || (await loadConfig());
  validateConfig(config);

  const botToken = config.telegram.botToken;
  const chatId = options.chatId || config.telegram.chatId;

  const retries = options.retries ?? 2;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        const detail = data?.description || "Unknown Telegram API error";
        const retryable = response.status === 429 || response.status >= 500;

        if (retryable && attempt < retries) {
          await sleep(800 * (attempt + 1));
          continue;
        }

        throw new Error(`Failed to send Telegram message: ${detail}`);
      }

      return data;
    } catch (error) {
      lastError = error;
      const retryable = /fetch failed|network|timed out|ECONNRESET|ENOTFOUND/i.test(
        String(error?.message || "")
      );
      if (!retryable || attempt >= retries) {
        throw error;
      }
      await sleep(800 * (attempt + 1));
    }
  }

  throw lastError || new Error("Failed to send Telegram message");
}
