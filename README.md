# Grok Device

**App testing shell** for Grok on Android — Play Store install/update flows and login/logout —
built on the [agent-device](https://oss.callstack.com/agent-device/docs/quick-start) SDK.

Architecture mirrors [OpenCode](https://github.com/anomalyco/opencode) v2 patterns
(**core + server + thin multi-surface clients**), with a **QA Stage UI** (device-as-hero)
inspired by internal qa-viewer design.

```
packages/
  core/      recipes · traces/glyphs · jobs/heal · runs/ persistence · snapshot
  server/    HTTP + SSE API
  cli/       primary host (TTY → TUI)
  tui/       terminal testing workspace
  ui/        Solid design system + themes
  app/       Stage UI (phone · steps · overlays · artifacts)
  desktop/   Electron shell
```

## Quick start

```bash
vp install
pnpm dev                 # TTY → testing TUI
pnpm dev:serve           # HTTP+SSE on :8787
pnpm dev:app             # Solid Stage UI (needs serve)
pnpm dev:desktop         # Electron
```

## Stage UI (web / desktop)

```bash
pnpm dev:serve   # terminal 1
pnpm dev:app     # terminal 2
```

1. **Top bar** — device picker, pass/fail/healed badge, **Run**
2. **Phone stage** — frames, scrubber, **Overlays** (snapshot hit-rects on the glass)
3. **Steps** — recipes with **glyph rows**, run history, **Retry / heal →**
4. **Inspector** — accessibility tree → press on device
5. **Artifacts** — session evidence + disk `runs/`
6. **⌘K** — command palette

### Evidence on disk

Every finished job writes:

```
runs/<iso>_<action>_<device>_<id8>/
  run.json      # status, steps, glyphs, heal, frame index
  log.txt
  frames/001.png …
```

Override location with `GROK_DEVICE_RUNS_DIR`.

### Heal flow

1. A recipe fails → error callout on the step
2. Click **Retry / heal →** (or ⌘K → “Retry / heal selected job”)
3. On success the step is marked **healed** with a callout (qa-viewer style)

### Overlays

1. **Snapshot** (stage or Inspector)
2. Toggle **Overlays on**
3. Purple rects scale onto the phone glass — click to press that node

## API

```
GET  /health /meta /events
GET  /devices /actions /jobs /jobs/:id
POST /jobs
POST /jobs/:id/retry
POST /actions/:id/run
GET  /snapshot /screenshot
POST /interact /device/select
GET  /runs /runs/:id /runs/:id/frames/:file
```

## Env

| Variable               | Default                 | Meaning             |
| ---------------------- | ----------------------- | ------------------- |
| `WORK_ACCOUNT_MATCH`   | `teachx.ai`             | Alpha Play account  |
| `HOME_ACCOUNT_MATCH`   | `gmail.com`             | Restore after alpha |
| `PROD_ACCOUNT_MATCH`   | required for `*-prod`   | Prod account        |
| `AGENT_DEVICE_SERIAL`  | menu / UI               | Target device       |
| `GROK_DEVICE_URL`      | `http://127.0.0.1:8787` | Server for TUI/app  |
| `GROK_DEVICE_RUNS_DIR` | `<repo>/runs`           | Evidence root       |
| `INSTALL_TIMEOUT_MS`   | `300000`                | Install/update wait |

See [ARCHITECTURE.md](./ARCHITECTURE.md).
