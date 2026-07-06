# Grok Device

Production-minded **Android app testing** for Grok (Play Store + login flows), built on
[agent-device](https://oss.callstack.com/agent-device/docs/quick-start).

Architecture and theming follow [OpenCode](https://github.com/anomalyco/opencode) patterns
(core · HTTP/SSE · thin hosts · full theme resolve/v2). Product craft aims at the bar set by
teams like PostHog: clear empty states, CI exits, doctor checks, evidence on disk.

```
packages/
  core/      recipes · jobs · traces · doctor · JUnit/JSON reports · runs/
  server/    HTTP + SSE API
  cli/       doctor · run --json · serve · tui
  tui/       terminal workspace
  ui/        OpenCode theme engine + primitives
  app/       Stage UI (device hero · steps · overlays)
  desktop/   Electron shell
```

## 10-minute onboarding

```bash
vp install                 # or pnpm install
pnpm doctor                # node, adb, devices — fix anything red
pnpm dev:serve             # terminal 1 — API on :8787
pnpm dev:app               # terminal 2 — Stage UI
```

In the UI: pick a device → pick a recipe → **Run**.  
Evidence lands in `runs/<timestamp>_<action>_<device>_<id>/`.

## CLI (CI-friendly)

```bash
pnpm doctor

# Structured run (exit 0 = ok/healed, 1 = failed)
pnpm --filter @grok-device/cli exec tsx src/index.ts run logout --json
pnpm --filter @grok-device/cli exec tsx src/index.ts run update-last-alpha \
  --serial "$SERIAL" --junit ./junit.xml

# Matrix: every connected device
pnpm --filter @grok-device/cli exec tsx src/index.ts run logout --all-devices --json --junit ./matrix.xml

# Flake retries (default 3)
GROK_DEVICE_RETRY_ATTEMPTS=5 pnpm --filter @grok-device/cli exec tsx src/index.ts run login-google

# API
pnpm dev:serve
curl -s localhost:8787/health | jq .
curl -s localhost:8787/doctor | jq .
curl -s localhost:8787/report | jq .
curl -s localhost:8787/report/junit
```

## Product surfaces

| Surface  | Command            | Notes                                         |
| -------- | ------------------ | --------------------------------------------- |
| Stage UI | `pnpm dev:app`     | Offline gate, empty states, theme (OC tokens) |
| Electron | `pnpm dev:desktop` | Same app + native window tint                 |
| TUI      | `pnpm dev` / `tui` | Terminal workspace                            |
| Doctor   | `pnpm doctor`      | Node ≥22, adb, devices                        |

### UI behavior (quality bar)

- **Server offline** — full overlay with `pnpm dev:serve` + Retry
- **No devices** — empty states + adb hint
- **Job fail** — heal callout + Retry / heal
- **Frames** — scrubber only when captures exist
- **Themes** — OpenCode resolve + v2 (Settings / top bar Theme)

### Evidence layout

```
runs/<iso>_<action>_<device>_<id8>/
  run.json      # status, errorCode, deviceName, steps, frames index
  log.txt
  frames/001.png …
```

## API (selected)

```
GET  /health /doctor /meta /events
GET  /devices /actions /jobs /jobs/:id
POST /jobs  POST /jobs/:id/retry
GET  /report  GET /report/:id  GET /report/junit
GET  /snapshot /screenshot
POST /interact /device/select
GET  /runs /runs/:id /runs/:id/frames/:file
```

## Env

| Variable               | Default                 | Meaning               |
| ---------------------- | ----------------------- | --------------------- |
| `WORK_ACCOUNT_MATCH`   | `teachx.ai`             | Alpha Play account    |
| `HOME_ACCOUNT_MATCH`   | `gmail.com`             | Restore after alpha   |
| `PROD_ACCOUNT_MATCH`   | —                       | Required for `*-prod` |
| `AGENT_DEVICE_SERIAL`  | —                       | Default device        |
| `GROK_DEVICE_URL`      | `http://127.0.0.1:8787` | App/TUI server        |
| `GROK_DEVICE_RUNS_DIR` | `<repo>/runs`           | Evidence root         |
| `INSTALL_TIMEOUT_MS`   | `300000`                | Install/update wait   |

## Develop

```bash
pnpm typecheck
pnpm test                  # core unit tests (reports)
pnpm --filter @grok-device/app typecheck
```

See [ARCHITECTURE.md](./ARCHITECTURE.md).
