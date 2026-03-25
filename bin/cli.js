#!/usr/bin/env node

import { runCli } from "../src/agent/cli.js";
import { showErrorBox } from "../src/ui/display.js";

runCli().catch((error) => {
  showErrorBox(`Fatal error: ${error.message}`);
  process.exit(1);
});
