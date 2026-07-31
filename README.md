# Relay

Black-box testing for **web, Android, and iOS**—designed for people who can use a product even when
they cannot access or modify its source code. Mobile control is built on
[agent-device](https://oss.callstack.com/agent-device/docs/quick-start); web control uses Playwright
inside a Relay-owned browser profile.

Architecture and theming follow [OpenCode](https://github.com/anomalyco/opencode) patterns
(core · HTTP/SSE · thin hosts · full theme resolve/v2). Product craft aims at the bar set by
teams like PostHog: clear empty states, CI exits, doctor checks, evidence on disk.

```
packages/
  protocol/  connections · resources · revisions · generation schemas
  client/    authenticated project-scoped HTTP + SSE client
  core/      recipes · jobs · traces · doctor · JUnit/JSON reports · runs/
  server/    HTTP + SSE API
  cli/       doctor · run --json · serve · tui
  tui/       terminal workspace
  ui/        OpenCode theme engine + primitives
  app/       Stage UI (device hero · steps · overlays)
  desktop/   Electron shell
```

## First useful test in five minutes

```bash
vp install                 # or pnpm install
pnpm doctor                # node, adb, devices — fix anything red
pnpm dev:serve             # terminal 1 — API on :8787
pnpm dev:app               # terminal 2 — Stage UI
```

In the UI, open **Journeys**, choose a ready device, and select **Record journey**. Use the app at
your own pace. Stopping creates a temporary take: review its captured actions, remove anything
accidental, choose whether it reaches a new screen, an existing screen, or the end, then add that
transition to the journey map. Nothing is committed until that last decision. The canvas is a
free-form, Figma-like view of screens and the actions that connect them; the compact recipe below
it remains the target-neutral program Relay runs.

For a website, open **Settings → Targets**, add its start URL, and choose **Open & sign in**. Relay
opens a visible, isolated Chrome profile so login, MFA, consent, and CAPTCHA can be completed by a
person. Cookies from that profile persist locally and are reused by recordings, CLI runs,
schedules, and compatibility matrices; Relay never reads the user’s everyday browser profile.

The equivalent CLI flow is:

```bash
relay target add "Store staging" https://staging.example.com
relay target login <target-id>          # sign in normally, then press Enter
relay test run checkout --target <target-id>
```

Tests remain target-neutral: a tap/click, text entry, wait, screenshot, assertion, or reusable flow
has one recipe representation. Adapters translate it to the selected iOS, Android, or browser
target, and unsupported device-only operations fail explicitly instead of being silently skipped.

### Journey maps

Journey metadata is versioned independently of recipes. The current graph document has three small,
stable primitives: **screens**, **transitions**, and named **flow starts**. Layout, notes, and
planned routes are document concerns; recipe steps are execution concerns. That seam lets the
canvas change without changing an existing test, makes every edit reversible through the journey
history, and gives a future collaborative provider a bounded document to synchronize.

```text
Start screen ── recorded transition ──> Settings
                 └─ return transition ─> Start screen
```

Old journey metadata is read and converted lazily on the first graph edit. A v6 journey stores the
graph beside the existing revisioned metadata, so clients can evolve or migrate it without guessing
from a linear action list again.

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

## CLI (CI-friendly)

```bash
pnpm doctor

# Structured run (exit 0 = ok/healed, 1 = failed)
pnpm --filter @relay/cli exec tsx src/index.ts run logout --json
pnpm --filter @relay/cli exec tsx src/index.ts run update-last-alpha \
  --serial "$SERIAL" --junit ./junit.xml

# Matrix: every connected device
pnpm --filter @relay/cli exec tsx src/index.ts run logout --all-devices --json --junit ./matrix.xml

# Git-friendly test definitions
pnpm --filter @relay/cli exec tsx src/index.ts init
pnpm --filter @relay/cli exec tsx src/index.ts test list --json
pnpm --filter @relay/cli exec tsx src/index.ts test validate
pnpm --filter @relay/cli exec tsx src/index.ts test export login-x > tests/login-x.relay.yaml

# Browser setup is interactive once; later runs reuse the private login profile
pnpm --filter @relay/cli exec tsx src/index.ts target add "Store staging" https://staging.example.com
pnpm --filter @relay/cli exec tsx src/index.ts target list
pnpm --filter @relay/cli exec tsx src/index.ts target login <target-id>
pnpm --filter @relay/cli exec tsx src/index.ts target check <target-id>
pnpm --filter @relay/cli exec tsx src/index.ts test run login-x --target <target-id>

# Named compatibility matrices freeze the observed targets before execution
pnpm --filter @relay/cli exec tsx src/index.ts matrix list
pnpm --filter @relay/cli exec tsx src/index.ts matrix validate release-smoke
pnpm --filter @relay/cli exec tsx src/index.ts test run login-x --matrix release-smoke --junit ./matrix.xml

# Bounded cross-platform trial campaign with aggregate evidence coverage
pnpm --filter @relay/cli exec tsx src/index.ts soak login-x --matrix release-smoke --repeat 10

# Flake retries (default 3)
RELAY_RETRY_ATTEMPTS=5 pnpm --filter @relay/cli exec tsx src/index.ts run login-google

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
- **Execution timeline** — one planned/live/replay timeline; screenshots attach to the exact step
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
GET /recipes/:id/yaml  POST /recipes/import
GET/PUT  /project/variables /recipes/:id/journey
POST /generate
GET  /report  GET /report/:id  GET /report/junit
GET  /snapshot /screenshot
POST /interact /device/select
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

The former `GROK_DEVICE_*` environment variables remain accepted as compatibility aliases.
| `INSTALL_TIMEOUT_MS` | `300000` | Install/update wait |

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
```

See [ARCHITECTURE.md](./ARCHITECTURE.md).
