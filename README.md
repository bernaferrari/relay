# Grok Device

**App testing shell** for Grok on Android — Play Store install/update flows and login/logout —
built on the [agent-device](https://oss.callstack.com/agent-device/docs/quick-start) SDK.

Architecture mirrors [OpenCode](https://github.com/anomalyco/opencode) v2 patterns
(**core + server + thin multi-surface clients**), aimed at **device testing**, not coding agents.

```
packages/
  core/      recipes · action catalog · jobs/sessions · event bus · snapshot/screenshot
  server/    HTTP + SSE API
  cli/       primary host (TTY → TUI)
  tui/       terminal testing workspace
  ui/        Solid design system + themes
  app/       Solid workspace (devices · actions · inspector · screen · activity)
  desktop/   Electron shell
```

## Quick start

```bash
vp install
pnpm dev                 # TTY → testing TUI
pnpm dev:serve           # HTTP+SSE on :8787
pnpm dev:app             # Solid web UI (needs serve)
pnpm dev:desktop         # Electron
pnpm dev:cli             # same as dev
```

Direct recipes:

```bash
pnpm --filter @grok-device/cli exec tsx src/index.ts logout
pnpm --filter @grok-device/cli exec tsx src/index.ts update-last-alpha
pnpm --filter @grok-device/cli exec tsx src/index.ts interactive
```

## Testing workspace (web / desktop)

With `pnpm dev:serve` running:

1. **Devices** sidebar — pick serial
2. **Actions** — run Play Store / Grok recipes (queued jobs)
3. **Inspector** — capture accessibility snapshot, click nodes to press
4. **Screen** — capture screenshot
5. **Activity** — live SSE job logs
6. **⌘K** — command palette

## API

```
GET  /health /meta /events
GET  /devices /actions /jobs
POST /jobs
GET  /snapshot /screenshot
POST /interact /device/select
```

## Env

| Variable              | Default                 | Meaning             |
| --------------------- | ----------------------- | ------------------- |
| `WORK_ACCOUNT_MATCH`  | `teachx.ai`             | Alpha Play account  |
| `HOME_ACCOUNT_MATCH`  | `gmail.com`             | Restore after alpha |
| `PROD_ACCOUNT_MATCH`  | required for `*-prod`   | Prod account        |
| `AGENT_DEVICE_SERIAL` | menu / UI               | Target device       |
| `GROK_DEVICE_URL`     | `http://127.0.0.1:8787` | Server for TUI/app  |
| `INSTALL_TIMEOUT_MS`  | `300000`                | Install/update wait |

See [ARCHITECTURE.md](./ARCHITECTURE.md).
