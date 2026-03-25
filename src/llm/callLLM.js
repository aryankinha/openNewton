import { loadConfig, validateConfig } from "../config/index.js";
import { DEFAULT_MODELS } from "./providers.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }

  return messages.map((msg) => ({
    role: msg.role || "user",
    content: String(msg.content ?? "")
  }));
}

async function postJson(url, body, headers = {}, options = {}) {
  const provider = options.provider || "llm";
  const model = options.model || "unknown-model";
  const retries = options.retries ?? 2;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: JSON.stringify(body)
      });

      const text = await response.text();
      let json;

      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }

      if (!response.ok) {
        const status = response.status;
        const detail = json?.error?.message || json?.message || text || "Unknown provider error";

        if ((status === 429 || status >= 500) && attempt < retries) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const baseWaitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1200 * (attempt + 1);
          await sleep(baseWaitMs);
          continue;
        }

        if (status === 429) {
          throw new Error(
            `LLM rate-limited for provider=${provider} model=${model}. ` +
              `Detail: ${detail}. Try again in a moment, or switch model/provider via init.`
          );
        }

        throw new Error(
          `LLM API request failed (${status}) for provider=${provider} model=${model}: ${detail}`
        );
      }

      return json;
    } catch (error) {
      lastError = error;
      const isTransientNetworkError = /fetch failed|network|timed out|ECONNRESET|ENOTFOUND/i.test(
        String(error?.message || "")
      );

      if (!isTransientNetworkError || attempt >= retries) {
        throw error;
      }

      await sleep(1200 * (attempt + 1));
    }
  }

  throw lastError;
}

function parseOpenAIToolCall(data) {
  const raw = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!raw?.function?.name) {
    return null;
  }

  let args = {};
  const rawArgs = raw.function.arguments;
  if (typeof rawArgs === "string" && rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      args = {};
    }
  } else if (rawArgs && typeof rawArgs === "object") {
    args = rawArgs;
  }

  return {
    name: raw.function.name,
    arguments: args
  };
}

function parseClaudeToolCall(data) {
  const block = Array.isArray(data?.content)
    ? data.content.find((item) => item?.type === "tool_use" && item?.name)
    : null;

  if (!block) {
    return null;
  }

  return {
    name: block.name,
    arguments: block.input && typeof block.input === "object" ? block.input : {}
  };
}

function parseGeminiToolCall(data) {
  const part = data?.candidates?.[0]?.content?.parts?.find((item) => item?.functionCall?.name);
  const functionCall = part?.functionCall;

  if (!functionCall?.name) {
    return null;
  }

  return {
    name: functionCall.name,
    arguments: functionCall.args && typeof functionCall.args === "object" ? functionCall.args : {}
  };
}

async function callOpenAI(messages, apiKey, model) {
  const data = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { model, messages },
    { Authorization: `Bearer ${apiKey}` },
    { provider: "openai", model }
  );

  return {
    content: data?.choices?.[0]?.message?.content || "",
    toolCall: parseOpenAIToolCall(data)
  };
}

async function callClaude(messages, apiKey, model) {
  const system = messages.find((m) => m.role === "system")?.content;
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const data = await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      model,
      system,
      max_tokens: 1024,
      messages: anthropicMessages
    },
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    { provider: "claude", model }
  );

  return {
    content: data?.content?.[0]?.text || "",
    toolCall: parseClaudeToolCall(data)
  };
}

async function callGemini(messages, apiKey, model) {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { contents },
    {},
    { provider: "gemini", model }
  );

  return {
    content: data?.candidates?.[0]?.content?.parts?.[0]?.text || "",
    toolCall: parseGeminiToolCall(data)
  };
}

async function callGrok(messages, apiKey, model) {
  const data = await postJson(
    "https://api.x.ai/v1/chat/completions",
    { model, messages },
    { Authorization: `Bearer ${apiKey}` },
    { provider: "grok", model }
  );

  return {
    content: data?.choices?.[0]?.message?.content || "",
    toolCall: parseOpenAIToolCall(data)
  };
}

async function callOpenRouter(messages, apiKey, model) {
  const data = await postJson(
    "https://openrouter.ai/api/v1/chat/completions",
    { model, messages },
    { Authorization: `Bearer ${apiKey}` },
    { provider: "openrouter", model }
  );

  return {
    content: data?.choices?.[0]?.message?.content || "",
    toolCall: parseOpenAIToolCall(data)
  };
}

async function callHuggingFace(messages, apiKey, model) {
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  const data = await postJson(
    `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
    {
      inputs: prompt,
      parameters: {
        max_new_tokens: 512,
        return_full_text: false
      }
    },
    { Authorization: `Bearer ${apiKey}` },
    { provider: "huggingface", model }
  );

  const content = Array.isArray(data) ? data?.[0]?.generated_text : data?.generated_text;
  return { content: content || "" };
}

export async function callLLM(messages, options = {}) {
  const cfg = options.config || (await loadConfig());
  validateConfig(cfg);

  const provider = cfg.llm.provider;
  const apiKey = cfg.llm.apiKey;
  const model = options.model || cfg.llm.model || DEFAULT_MODELS[provider];
  const normalized = normalizeMessages(messages);

  switch (provider) {
    case "openai":
      return callOpenAI(normalized, apiKey, model);
    case "claude":
      return callClaude(normalized, apiKey, model);
    case "gemini":
      return callGemini(normalized, apiKey, model);
    case "grok":
      return callGrok(normalized, apiKey, model);
    case "openrouter":
      return callOpenRouter(normalized, apiKey, model);
    case "huggingface":
      return callHuggingFace(normalized, apiKey, model);
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
