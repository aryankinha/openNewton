import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";

const COLOR = {
  mcp: chalk.blue,
  agent: chalk.yellow,
  event: chalk.blue,
  notify: chalk.green,
  success: chalk.green,
  error: chalk.red,
  userPrompt: chalk.bold.cyan,
  agentOutput: chalk.bold.green,
  sectionToday: chalk.bold.blue,
  sectionPriority: chalk.bold.yellow,
  sectionPlan: chalk.bold.blue,
  sectionWarning: chalk.bold.yellow
};

const PREFIX = {
  mcp: "[mcp]",
  agent: "[agent]",
  event: "[event]",
  notify: "[notify]",
  error: "[error]"
};

export const UI = {
  separator() {
    return chalk.gray("-".repeat(52));
  },

  userPromptLabel() {
    return COLOR.userPrompt("You ➜ ");
  },

  agentLabel() {
    return COLOR.agentOutput("Agent ➜ ");
  },

  mcp(message) {
    console.log(COLOR.mcp(`${PREFIX.mcp} ${message}`));
  },

  agent(message) {
    console.log(COLOR.agent(`${PREFIX.agent} ${message}`));
  },

  event(message) {
    console.log(COLOR.event(`${PREFIX.event} ${message}`));
  },

  notify(message) {
    console.log(COLOR.notify(`${PREFIX.notify} ${message}`));
  },

  success(message) {
    console.log(COLOR.success(message));
  },

  error(message) {
    console.error(COLOR.error(`${PREFIX.error} ${message}`));
  },

  info(message) {
    console.log(message);
  },

  sectionHeader(name) {
    const key = String(name || "").toUpperCase();
    if (key === "TODAY") return COLOR.sectionToday(key);
    if (key === "PRIORITY") return COLOR.sectionPriority(key);
    if (key === "PLAN") return COLOR.sectionPlan(key);
    if (key === "WARNING") return COLOR.sectionWarning(key);
    return chalk.bold.blue(key);
  },

  boxed(message, options = {}) {
    const borderColor = options.borderColor || "gray";
    const title = options.title;

    return boxen(message, {
      padding: 1,
      margin: 0,
      borderColor,
      borderStyle: "round",
      title,
      titleAlignment: "center"
    });
  },

  printBoxed(message, options = {}) {
    console.log(this.boxed(message, options));
  },

  spinner(text = "Thinking...") {
    return ora({ text, isSilent: !process.stdout.isTTY });
  }
};
