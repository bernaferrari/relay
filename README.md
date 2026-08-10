# Relay

Black-box testing for **web, Android, and iOS**—designed for people who can use a product even when
they cannot access or modify its source code. Mobile control is built on
[agent-device](https://oss.callstack.com/agent-device/docs/quick-start); web control uses Playwright
inside a Relay-owned browser profile.

Architecture follows [OpenCode](https://github.com/anomalyco/opencode) patterns
(core · HTTP/SSE · thin hosts). Product craft aims at the bar set by
teams like PostHog: clear empty states, project presence, golden CI smoke, doctor checks, evidence on disk.

```
packages/
  protocol/  canonical operations · actors · resources · awareness DTOs
  client/    authenticated project-scoped HTTP + SSE client
  core/      App Maps · authoring · jobs · evidence · target adapters
  server/    operation HTTP API · SSE · leases · artifacts
  cli/       server-first human/agent operation client
  mcp/       scoped MCP v2 adapter with native PNG screenshots
  tui/       terminal workspace
  ui/        OpenCode theme engine + primitives
  app/       App Map UI (canvas · device companion · runs)
  desktop/   Electron shell
```

## First useful test in five minutes

```bash
vp install                 # or pnpm install
pnpm doctor                # node, adb, devices — fix anything red
pnpm dev:serve             # terminal 1 — API on :8787
pnpm dev:app               # terminal 2 — App Map UI
```

Relay reopens the latest **App Map** as a free-form canvas. A new project starts with one unsaved
blank map instead of accumulating drafts. Use the device normally, then press the single **Record**
control when you want to capture a connection. Stopping creates a temporary Take: trim accidental
actions, choose whether it reaches a new screen, an existing screen, or the end, and replay it until
it is flawless. Only **Add to map** commits its executable steps, evidence, and Connection. The
permanent **Device** control reopens the live target at any time; it is not an empty-state action or
a separate mode.

For a website, open **Settings → Targets**, add its start URL, and choose **Open & sign in**. Relay
opens a visible, isolated Chrome profile so login, MFA, consent, and CAPTCHA can be completed by a
person. Cookies from that profile persist locally and are reused by recordings, CLI runs,
schedules, and compatibility matrices; Relay never reads the user’s everyday browser profile.

The equivalent CLI flow is:

```bash
relay target create --input '{"name":"Store staging","url":"https://staging.example.com"}'
relay target open <target-id>           # sign in normally in Relay's isolated profile
relay flow run <map-id> <flow-id> --input '{"serial":"<device>"}'
relay job locale-matrix start --input '{"appMapId":"<map>","flowId":"<flow>","serial":"<device>","locales":["en","pt-BR"]}'
```

Tests remain target-neutral: a tap/click, text entry, wait, screenshot, assertion, or reusable flow
has one recipe representation. Adapters translate it to the selected iOS, Android, or browser
target, and unsupported device-only operations fail explicitly instead of being silently skipped.

### App Maps

An App Map is the canonical product model. Same three words in the UI, CLI, and agents:

- **Screen** — a unique app state. **Connection** — the recorded path between two screens.
- **Variable** — a list the app can be in (language, theme, location). Teach 1–2 rows; infer the rest. Relay does not invent how to open that list.
- **Test** — what you run once (a recorded path, or “open every Settings row”).
- **Run matrix** — a visible grid: every selected device state × every selected test. Run one cell or the full matrix.

Preview the exact expansion before using a device. `dry-run` is an alias of
`preflight`; both report modifier values, checks, screenshots, estimated time,
and readiness blockers from the same compiler used by the desktop app.

```bash
relay run-matrix preflight <map-id> <matrix-id> --input '{"serial":"<device>"}'
relay run-matrix run <map-id> <matrix-id> --input '{"serial":"<device>"}'
```

Layout and notes are document concerns. A selected path compiles to target-neutral recipe IR when it
runs — people never author a second recipe library. The same map has **Screens** and **Results**
projections for browsing large products without another source of truth.

```text
Start screen ── recorded transition ──> Settings
                 └─ return transition ─> Start screen
```

Relay is pre-release, so App Map schema v1 is the only accepted canvas format. Unsupported state is
discarded; Relay does not carry a migration reader or dual-write path.

Every recording captures semantic observations before and after the action. Relay normalizes
volatile UI details, matches the destination to an existing screen when possible, and creates a new
screen only when it is genuinely new. Automated discovery uses the same identity model, so explored
branches and cycles merge into the authored map instead of becoming a separate report. Each run
freezes the chosen transition path and projects live, passed, failed, and healed status back onto the
same nodes and edges.

### Reusable recorded setups and app builds

Any recorded test can be attached to another test as an editable reusable flow. This is the
intended pattern for sign-in, account recovery, permissions, onboarding, deep links, or any other
repeatable setup—not a login-only feature. Parent runs pass their frozen variables into the attached
flow, so an approved `login_email` list can rotate test accounts without duplicating the recording.

To make an attachment explicit, open a recorded flow’s **Inputs** tab and declare the names it
accepts. At the attachment step, bind those names to a literal or a project/test value. Both the
declaration and the binding live in tracked YAML; every run captures the resolved binding as
`reusable-flow-inputs` evidence. For example:

```yaml
parameters:
  - name: login_email
    label: Test account
    required: true
steps:
  - kind: type
    text: "{{login_email}}"
```

```yaml
steps:
  - kind: module
    recipeId: recorded-email-sign-in
    bindings:
      login_email: "{{account_email}}"
```

Human-gated moments are first-class too. Add a `pause` after the automated login when Okta,
MFA, CAPTCHA, a permission prompt, or a consent screen needs a real person. Relay pauses the
live device, shows the reason and action in the run surface, and resumes only when the operator
confirms. The optional timeout turns an abandoned handoff into a visible failure instead of an
infinite run:

```yaml
steps:
  - kind: module
    recipeId: recorded-okta-login
    bindings:
      login_email: "{{account_email}}"
  - kind: pause
    message: Approve the Okta sign-in on the device
    reason: consent
    resumeLabel: Continue after approval
    timeoutMs: 900000
    verifyAfter:
      target:
        label: Welcome
      timeoutMs: 15000
```

The checkpoint is generic and reusable: it can represent any user action that cannot be safely
automated. Each request and completion is preserved in the run evidence as
`human-intervention-requested` and `human-intervention-completed`. When `verifyAfter` is present,
Relay waits for the expected target after the operator continues and stores a
`human-intervention-verified` result instead of blindly moving to the next action.

For Android, the **App** step can inspect and optionally assert the installed package version,
install/update a selected local APK, or uninstall a package. The observed build is stored in the
immutable run report (`appVersion` and an `app-build` evidence artifact); Relay never uploads an APK
or account credentials to a model provider. Lifecycle operations explicitly reject unsupported
targets rather than pretending they work on iOS or browsers.

For a Git-first path:

```bash
pnpm --filter @relay/cli exec tsx src/index.ts init
# edit tests/<id>.relay.yaml
pnpm --filter @relay/cli exec tsx src/index.ts test format --check
pnpm --filter @relay/cli exec tsx src/index.ts test validate
pnpm --filter @relay/cli exec tsx src/index.ts test run <id> --target <target-id>
```

Evidence lands in `runs/<timestamp>_<action>_<device>_<id>/`.

### Collection policy and soak trials

Relay records input events, screenshots, video, UI trees, device/browser logs, network summaries,
and performance data automatically when the target exposes them. Three higher-risk collectors stay
off until explicitly enabled in **Settings → Privacy**: request/response bodies, audio-level probes,
and crash diagnostics. Consent is stored in `.relay/evidence.json`, attributed to the local user,
and frozen into every queued job and evidence manifest. Turning a collector off affects future jobs;
already-frozen runs remain auditable.

Every consequential project operation also enters a payload-safe, attributed Activity log. Export
the complete chronological log from **Settings → Privacy & evidence → Project activity**, or use the
same registered operation from the CLI:

```bash
relay activity export --json > relay-activity.json
```

The export is scoped to the configured organization and project. Its manifest records the scope,
time range, record count, and SHA-256 digest of the canonical NDJSON records so compliance tooling
can verify that the downloaded history was not silently changed. Full exports are deliberately not
returned inline through MCP because a mature project can contain megabytes of attributed records.

Evidence redaction is a separate, easy workspace toggle and defaults **off**. Its state is stored in
`.relay/privacy.json`; `RELAY_REDACTION_MODE=on|off` can lock it for a process. Relay refuses a
non-loopback server binding while redaction is off. With redaction disabled—or with network bodies
enabled—run artifacts may contain credentials, personal data, prompts, or customer content, so use
isolated trial accounts and control access to `runs/`.

For repeatable data-collection trials, define a compatibility matrix and run a bounded soak:

```bash
relay matrix validate release-trials
relay soak checkout --matrix release-trials --repeat 10
relay soak checkout --matrix release-trials --repeat 10 --json > soak-report.json
```

A soak freezes the observed Android, iOS, and browser targets before enqueueing, supports up to 100
repetitions per target and 500 total jobs, and reports product failures separately from harness
failures and uncertainty. Its evidence table exposes captured, partial, unsupported, denied,
failed, and missing counts per channel so a trial cannot look successful while silently collecting
poor data. The HTTP equivalents are `POST /jobs/soak` and `GET /reports/soak/:batchId`.

## CLI and agents

The CLI is a server-first operation client. It never starts an invisible second Relay runtime and
never imports core domain state. The app, CLI, TUI, and MCP adapter therefore see the same actor,
target lease, Authoring Session, Take revisions, App Map revision, progress, and events.

```bash
export RELAY_URL=http://127.0.0.1:8787
export RELAY_ORGANIZATION_ID=local
export RELAY_PROJECT_ID=default
export RELAY_ACTOR_ID=human:terminal

# Discover the public vocabulary and exact input contracts
pnpm --filter @relay/cli exec tsx src/index.ts --help
pnpm --filter @relay/cli exec tsx src/index.ts session --help

# Inspect state and receive a canonical PNG payload
pnpm --filter @relay/cli exec tsx src/index.ts map list --json
pnpm --filter @relay/cli exec tsx src/index.ts target screenshot <serial> --json

# Every recording action names its server-owned session explicitly
pnpm --filter @relay/cli exec tsx src/index.ts session create --input '{...}' --json
pnpm --filter @relay/cli exec tsx src/index.ts session start <session-id> --json
pnpm --filter @relay/cli exec tsx src/index.ts session tap <session-id> --input '{...}' --json
pnpm --filter @relay/cli exec tsx src/index.ts session stop <session-id> --json
pnpm --filter @relay/cli exec tsx src/index.ts take replay <session-id> --json
pnpm --filter @relay/cli exec tsx src/index.ts session commit <session-id> --input '{...}' --json
```

`--ndjson` emits typed progress/events followed by one terminal result; diagnostics remain on stderr.
Use `--credential-source env:RELAY_AUTH_TOKEN` instead of putting a token in arguments. MCP clients
can run `pnpm dev:mcp`; `relay_target_screenshot_capture` returns native `image/png` content directly
to the model, while every mutation still goes through the same confirmations, leases, revisions, and
cancellation path. See [packages/mcp/README.md](./packages/mcp/README.md).

Relay can explore from the UI or through the same discovery and App Map operations available to CLI
and MCP clients. OpenRouter is optional: without it Relay follows its deterministic semantic control
ordering; with it, the planner chooses only among controls Relay has already observed and marked safe.

```bash
export OPENROUTER_API_KEY=...
export OPENROUTER_MODEL=openai/gpt-4.1-mini # optional
export RELAY_GENERATION_PROVIDER=openrouter # default provider for generation.create
```

Agent exploration remains bounded by screen, transition, and time budgets. Purchases, deletion,
logout, password fields, and permission prompts stay blocked by default, and discovered paths arrive
as reviewable proposals rather than silently changing the map.

## Product surfaces

| Surface  | Command            | Notes                                         |
| -------- | ------------------ | --------------------------------------------- |
| Stage UI | `pnpm dev:app`     | Offline gate, empty states, theme (OC tokens) |
| Electron | `pnpm dev:desktop` | Same app + native window tint                 |

### Inspecting the real Electron app

`pnpm dev:desktop` publishes a loopback-only DevTools endpoint for its exact
renderer, including preload, IPC, and the private Relay service it spawned. In
another terminal, capture a screenshot and a machine-readable UI report with:

```bash
pnpm inspect:desktop
```

The command writes `packages/desktop/out/relay-electron.png` plus a JSON report
containing the renderer URL, viewport, console failures, layout overflow, and
accessible interactive controls. Pass `--reload`, `--settle 1200`, or
`--screenshot /tmp/relay.png` after `--` when a specific state needs inspection.
| TUI | `pnpm dev` / `tui` | Terminal workspace |
| Doctor | `pnpm doctor` | Node ≥22, adb, devices |

- **Server offline** — full overlay with `pnpm dev:serve` + Retry
- **No devices** — empty states + adb hint
- **Job fail** — heal callout + Retry / heal
- **Execution timeline** — one planned/live/replay timeline; screenshots attach to the exact step
- **Tree crawl (screen corpus)** — from **Runs → Tree crawl**, map a settings tree once, replay across languages/switcher options, export a labeled pack under `.relay/corpus/`. Shared navigation helpers live in `@relay/core` `explore`. Ops are `corpus.*` (HTTP `/corpus`). Agent/CLI explore verbs: `target.ui.describe`, `target.ui.back`, `target.ui.scrollCollect`.
- **Themes** — OpenCode resolve + v2 (Settings / top bar Theme)
- **Desktop updates** — packaged macOS/Windows builds check at launch and every four hours; a
  downloaded signed release shows its changelog with **Restart & update** or **Skip this version**
- **Scheduled runs** — the selected physical device or managed browser target is frozen into the
  local schedule; scheduled trials preserve the same generated data provenance and evidence as a
  manually started run

### Evidence layout

```
runs/<iso>_<action>_<device>_<id8>/
  run.json      # status, errorCode, deviceName, steps, frames index
  evidence.json # channel completeness, ordered events, frozen consent grants
  log.txt
  frames/001.png …
```

## API (selected)

```
GET  /health /doctor /meta /events
GET/PUT /settings/privacy /settings/evidence
GET  /devices /actions /jobs /jobs/:id
POST /jobs  POST /jobs/:id/retry
POST /jobs/soak  GET /reports/soak/:batchId
GET/POST /projects /builds /device-pools /device-leases
GET/POST /matrices  POST /matrices/:id/resolve  GET /target-profiles
GET/POST /targets  POST /targets/:id/open  POST /targets/:id/preflight
GET/POST /app-maps  GET /app-maps/:appMapId
GET /recipes/:id/yaml  POST /recipes/import
GET/PUT /project/variables
POST /generate
GET  /report  GET /report/:id  GET /report/junit
GET  /snapshot /screenshot
POST /interact /device/select
GET  /target/ui  POST /target/ui/back  POST /target/ui/scroll-collect
GET/POST /corpus  POST /corpus/:id/start  GET /corpus/:id/export
GET  /runs /runs/:id /runs/:id/frames/:file
```

## Env

| Variable                  | Default                 | Meaning                                                                                  |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `WORK_ACCOUNT_MATCH`      | `teachx.ai`             | Alpha Play account                                                                       |
| `HOME_ACCOUNT_MATCH`      | `gmail.com`             | Restore after alpha                                                                      |
| `PROD_ACCOUNT_MATCH`      | —                       | Required for `*-prod`                                                                    |
| `AGENT_DEVICE_SERIAL`     | —                       | Default device                                                                           |
| `RELAY_URL`               | `http://127.0.0.1:8787` | App/TUI server                                                                           |
| `RELAY_RUNS_DIR`          | `<repo>/runs`           | Evidence root                                                                            |
| `RELAY_TESTS_DIR`         | `<repo>/tests`          | Git-tracked YAML test definition root                                                    |
| `RELAY_AUTH_TOKEN`        | —                       | Bearer token required for non-loopback HTTP serving                                      |
| `RELAY_REDACTION_MODE`    | workspace setting       | Lock evidence redaction `on` or `off` for this process                                   |
| `RELAY_GITHUB_REPOSITORY` | —                       | `owner/repo` for public GitHub Releases through Electron's update service                |
| `RELAY_UPDATE_FEED_URL`   | —                       | Custom signed update feed; supports `{platform}`, `{arch}`, and `{version}` placeholders |
| `INSTALL_TIMEOUT_MS`      | `300000`                | Install/update wait                                                                      |

The HTTP server refuses non-loopback bindings without a bearer token. For LAN or remote access,
set a long random `RELAY_AUTH_TOKEN` (24+ characters) or pass `--token`. Keep the default
loopback binding for local desktop development.

Sensitive evidence redaction is off by default and can be changed in **Settings → Privacy &
evidence**. The choice is stored in `.relay/privacy.json` and applies to future evidence and API
responses; finalized runs are never rewritten. `RELAY_REDACTION_MODE=on|off` overrides and locks
the UI setting. Relay refuses non-loopback bindings whenever redaction is disabled.

### Desktop update delivery

Updates are deliberately disabled in development and on Linux (where users should use their package
manager). For packaged macOS and Windows builds, set **one** update source at release time:

```bash
# Public repository: GitHub Releases through Electron's hosted update bridge.
RELAY_GITHUB_REPOSITORY=your-org/relay

# Or an enterprise/static Squirrel-compatible feed.
RELAY_UPDATE_FEED_URL='https://updates.example.com/relay/{platform}/{arch}/{version}'
```

The app never downloads or installs an update until Electron has accepted the signed release from the
configured feed. The **About** settings section has a manual “Check now” control; automatic checks run
at startup and then every four hours. macOS artifacts must be code-signed before auto-update can work.

## Develop

```bash
pnpm typecheck
pnpm test                  # core unit tests (reports)
pnpm --filter @relay/app typecheck
pnpm test:golden           # device smoke; skips when server/device unavailable
```

See [ARCHITECTURE.md](./ARCHITECTURE.md).
