import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgent } from "./agentEngine.js";
import { formatAgentResponse, showErrorBox } from "../ui/display.js";
import { UI } from "../ui/logger.js";

export async function runChat() {
  UI.info("Newton Agent Chat");
  UI.info("Type 'exit' to quit\n");

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const question = (await rl.question(UI.userPromptLabel())).trim();
      if (!question) continue;
      if (question.toLowerCase() === "exit") break;

      const spinner = UI.spinner("Thinking...");
      spinner.start();

      try {
        const content = await runAgent(question);
        spinner.succeed("Done");
        const formatted = formatAgentResponse(content || "(empty response)");
        UI.info(`${UI.agentLabel()}${formatted}\n`);
      } catch (error) {
        spinner.fail("Error");
        const message = String(error?.message || "Unknown error");
        if (/rate-limited|\(429\)|provider returned error/i.test(message)) {
          showErrorBox(
            "LLM provider is temporarily rate-limited. Please retry in 20-60 seconds, " +
              "or run init and switch to a different provider/model."
          );
          UI.info("");
        } else {
          showErrorBox(message);
          UI.info("");
        }
      }
    }
  } finally {
    rl.close();
  }
}
