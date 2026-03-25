export const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  claude: "claude-3-haiku-20240307",
  gemini: "gemini-2.5-flash",
  grok: "grok-1",
  openrouter: "meta-llama/llama-3-8b-instruct",
  huggingface: "mistralai/Mistral-7B-Instruct-v0.2"
};

export const PROVIDERS = Object.keys(DEFAULT_MODELS);
