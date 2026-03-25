# Newton Agent

Newton Agent is a production-ready Node.js CLI assistant for Newton learners. It connects LLMs, MCP tools, and Telegram to generate daily plans, run autonomous monitoring, and answer study queries.

## Install

```bash
npm install -g newton-agent
```

You can also run without global install:

```bash
npx newton-agent
```

## Setup

```bash
newton-agent init
```

Init flow will:
- ask provider + API key
- auto-assign default model for that provider
- ask Telegram bot token + chat ID
- configure MCP (Newton by default)
- run setup validation checks (LLM, Telegram, MCP)

## Start

```bash
newton-agent start
```

This starts:
- daily summary scheduler
- autonomous monitor
- Telegram listener

If already running, `start` will fail. Use `--restart` to replace current session:

```bash
newton-agent start --restart
```

## Main Commands

- `newton-agent init` - guided setup + validation
- `newton-agent doctor` - full health diagnostics
- `newton-agent start` - start in background
- `newton-agent start --foreground --run-now` - run in current terminal and trigger daily job
- `newton-agent stop` - stop all running scheduler sessions
- `newton-agent chat` - interactive CLI chat
- `newton-agent monitor-now` - run autonomous monitor with live data
- `newton-agent monitor-now --mock --dry-run` - simulate monitor without sending Telegram
- `newton-agent telegram-listen` - run Telegram listener only
- `newton-agent mcp-auth --reset` - force fresh MCP authentication flow
- `newton-agent state-status` - inspect dedupe state
- `newton-agent state-reset` - reset dedupe state

## Telegram Usage

Supported commands:
- `/start`
- `/help`
- `/today`
- `/assignments`
- `/attendance`
- `/tomorrow`

Natural messages also work without `/start`.

## Example Output

```text
📅 TODAY
• GenAI - B: RAG Introduction (08:00)
• DVA - B: Bivariate Analysis (10:00)

🎯 PRIORITY
• SD Lab: Observer pattern assignment (5h left)
• DM Lab: Rules of Inference worksheet (9h left)

🧭 PLAN
• Finish SD Lab first in one deep-work block.
• Revise GenAI notes after class.

⚠️ WARNING
• 1 missed lecture needs review.
```

## Doctor Output

`newton-agent doctor` prints:

```text
STATUS:
- CONFIG: OK
- LLM: OK
- MCP: OK
- TELEGRAM: OK
- SCHEDULER: OK
```

## Runtime Files

- Config: `~/.newton-agent/config.json`
- PID lock: `~/.newton-agent/scheduler.pid`
- State store: `~/.newton-agent/state.json`

## Requirements

- Node.js 20+
- Valid provider API key
- Telegram bot token + chat ID
- MCP server available (Newton MCP by default)
