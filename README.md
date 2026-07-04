# Grok Device

Android recipes for Grok (Play Store + app login/logout) using the
[agent-device](https://oss.callstack.com/agent-device/docs/quick-start) TypeScript SDK.

Architecture is inspired by [OpenCode](https://github.com/anomalyco/opencode) v2:
**core domain behind a small HTTP API**, with thin hosts for CLI, TUI, web app, and Electron desktop.

```
packages/
  core/      device helpers + Play Store + Grok recipes + action catalog
  server/    minimal HTTP API over core (for UI hosts)
  cli/       interactive + direct CLI (primary product surface)
  tui/       themed terminal UI
  ui/        Solid design system + themes
  app/       Solid device-control app (web + desktop renderer)
  desktop/   Electron shell (Platform IPC → app)
```

## Quick start

```bash
vp install                         # or: pnpm install
pnpm dev                           # interactive CLI: device → action
pnpm dev:serve                     # HTTP API on :8787
pnpm dev:tui                       # terminal UI
pnpm dev:app                       # Solid web UI (needs serve running)
pnpm dev:desktop                   # Electron (optional)
```

Direct actions:

```bash
pnpm --filter @grok-device/cli exec tsx src/index.ts logout
pnpm --filter @grok-device/cli exec tsx src/index.ts update-last-alpha
PROD_ACCOUNT_MATCH=gmail.com pnpm --filter @grok-device/cli exec tsx src/index.ts update-last-prod
```

## Actions

### Play Store

| Action                   | Behavior                                       |
| ------------------------ | ---------------------------------------------- |
| **update-last-alpha**    | → teachx → Update only → restore gmail         |
| **install-last-alpha**   | → teachx → Update or Install → restore gmail   |
| **reinstall-last-alpha** | → teachx → Uninstall → Install → restore gmail |
| **update-last-prod**     | → PROD_ACCOUNT_MATCH → Update only             |
| **install-last-prod**    | → prod → Uninstall → Install                   |

### Grok app

| Action                       | Behavior                       |
| ---------------------------- | ------------------------------ |
| **login-google / email / x** | Provider → notifications Allow |
| **logout**                   | Menu → Settings → Sign out     |

## Env

| Variable              | Default                 | Meaning                   |
| --------------------- | ----------------------- | ------------------------- |
| `WORK_ACCOUNT_MATCH`  | `teachx.ai`             | Work / alpha Play account |
| `HOME_ACCOUNT_MATCH`  | `gmail.com`             | Restore after alpha       |
| `PROD_ACCOUNT_MATCH`  | required for `*-prod`   | Prod account match        |
| `AGENT_DEVICE_SERIAL` | set by menu             | Target phone              |
| `GROK_DEVICE_URL`     | `http://127.0.0.1:8787` | Server URL for TUI/app    |
| `INSTALL_TIMEOUT_MS`  | `300000`                | Wait after update/install |

## Design notes

- **UIs never import domain internals for execution paths they share** — they call `runAction` via core (CLI/TUI in-process) or HTTP (app/desktop).
- **Platform injection** (OpenCode pattern): Solid `app` receives a `Platform` from web or Electron preload.
- **Theming**: JSON themes in `@grok-device/ui` → CSS variables; TUI has a parallel ANSI palette.
- OpenCode vendor checkout lives in `vendor/opencode` (gitignored) for reference only.

Failures **throw** (CLI) or return `{ ok: false }` (server). Debug with the `agent-device` CLI when something flakes.
