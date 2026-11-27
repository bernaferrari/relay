# @relay/cli

Relay is a local-first verification tool for web and mobile products. The `relay` command starts or attaches to the local Relay service, saves Tests, runs them, and returns evidence-backed verdicts.

## Install

```bash
npm install -g @relay/cli
```

Or run it without a global install:

```bash
npx -y @relay/cli --help
```

Node.js 24 or newer is required.

## Start in a web project

From the project root:

```bash
relay init
relay ci .relay/tests --confirm
```

`relay init` detects a running local development server when possible, writes `.relay/config.json` and `.relay/tests/smoke.yaml`, and prints the next commands. Plain-English steps use Relay's model-backed runner; set `OPENROUTER_API_KEY` before running them, or record exact model-free steps with `relay guide record`.

## MCP

After the local Relay service is running, add the MCP server to Claude Code:

```bash
claude mcp add relay -- npx -y @relay/mcp
```

Use `relay guide` for task-specific CLI and MCP guidance.
