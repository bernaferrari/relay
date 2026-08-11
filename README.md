# Relay

Relay maps real products and replays meaningful tests across web, Android, and iOS—without needing
their source code.

Connect a target, capture the paths a person already knows, and Relay turns them into an executable
**App Map**. The same map can then answer questions such as:

- Does every Settings screen render in all 45 languages?
- Do low, medium, and high reasoning modes all complete the same conversation test?
- Does a checkout still work on every supported device and app build?
- Which screen changed, what action reached it, and what evidence proves the result?

Relay is local-first and pre-release. The desktop app, CLI, TUI, and MCP adapter all use the same
project-scoped operation API and evidence store. Mobile control is built on
[agent-device](https://oss.callstack.com/agent-device/docs/quick-start); browser control uses a
Relay-owned Playwright profile.

## The product model

Relay uses five user-facing concepts:

| Concept        | Meaning                                             | Example                                     |
| -------------- | --------------------------------------------------- | ------------------------------------------- |
| **Screen**     | A distinct product state                            | Settings, Appearance, Widget                |
| **Connection** | Recorded actions between two screens                | Settings → tap Appearance → Appearance      |
| **Modifier**   | A reusable way to change one dimension              | Language = English, Italian, Japanese       |
| **Test**       | The path or group of screens to verify once         | Visit every mapped Settings screen          |
| **Run matrix** | Every selected modifier state × every selected test | 45 languages × 10 screens = 450 screenshots |

```text
Language modifier ─┐
Theme modifier ────┼─ every selected state × Settings tour ──> Results
Account modifier ──┘
```

Modifiers are not magic labels. Each one stores how to apply a value and return to the test's start
screen. Tests remain independent, so a new language or model can reuse every existing test without
rerecording it. Screenshot policy belongs to each test: every screen, final screen, failures only,
or none.

## Start the desktop app

Requirements: Node.js 22 or newer, `pnpm`, and `vp` (Vite+). Android work also needs `adb`; physical
iOS control needs the local Apple developer tooling used by agent-device.

```bash
vp install
pnpm doctor
pnpm dev:desktop
```

The Electron app starts its own loopback Relay service. For browser-only UI development, run the
service and app separately:

```bash
pnpm ensure:serve
pnpm dev:app
```

If setup behaves unexpectedly, run `vp env doctor`. Relay never starts a hidden second service from
the CLI.

## Map an Android app

1. Enable USB debugging, connect the phone, and approve the computer on the device.
2. Open **Device** and choose the connected Android target.
3. Navigate to the first useful screen and choose **Save screen** in the device panel.
4. Select the saved screen, start recording in the device panel, and perform one meaningful path.
5. Stop recording. Remove accidental actions in Take review, choose the destination, and replay the
   path.
6. Choose **Add to map** only when the replay reaches the intended screen.
7. Repeat, or group related screens into a reusable test.

An empty recording is discarded instead of asking to save. System confirmation controls such as a
recorder's own **Done** button are not authored as app actions. Relay prefers accessibility identity,
then visible text, then a verified point. Android's bundled UiAutomation helper owns the single
automation slot and can inspect windows even when a launcher accessibility service is also enabled.

The live device panel supports four accessibility-overlay policies: always, on hover, hidden while
retaining semantic data, or fully disabled. Disabling collection reduces data; merely hiding the
overlay does not.

## Run the same test across many states

The manual workflow does not require an agent:

1. Record or group the screens that make up the test.
2. Open **Run matrix** and create a modifier such as Language.
3. Teach Relay how to enter the language list, choose example rows, and return to the test start.
   Android app locales can be discovered dynamically when the app exposes them.
4. Select the values, tests, and screenshot policy.
5. Inspect the exact expansion. Run one cell to prove the setup, then run the matrix.
6. Review Results by logical screen, with modifier variants grouped together.

The expansion strategy is explicit:

- **Every combination** for a true Cartesian product.
- **Match rows** when values pair by index.
- **Every pair** to cover interactions across three or more modifiers with fewer device runs.

Preflight uses the same compiler as execution and reports the exact states, checks, expected
screenshots, duration estimate, and blockers before the device is touched.

## CLI

The root `relay` script is the canonical repository entry point:

```bash
pnpm relay --help
pnpm relay device list --json
pnpm relay map list --json
pnpm relay run-matrix preflight <map-id> <matrix-id> \
  --input '{"serial":"<device-serial>"}' --json
pnpm relay run-matrix run <map-id> <matrix-id> \
  --input '{"serial":"<device-serial>"}' --ndjson
pnpm relay run-matrix export <batch-id>
```

Useful device commands:

```bash
pnpm relay lease create <serial> --actor human:terminal
pnpm relay device screenshot <serial> --file current.png
pnpm relay device screenshot <serial> --mark 320,640 --file tap-preview.png
pnpm relay device interact <serial> --preview --file target-preview.png \
  --input '{"kind":"label","label":"Settings"}'
pnpm relay device interact <serial> \
  --actor human:terminal --input '{"kind":"label","label":"Settings"}'
pnpm relay device recover <serial>
```

`--preview` never performs the input. JSON results remain on stdout; waits and diagnostics remain on
stderr. `--ndjson` emits progress events followed by one terminal result. For a server on another
machine, use `--credential-source env:RELAY_AUTH_TOKEN` so secrets do not appear in process
arguments.

For the full command vocabulary, use family help such as `pnpm relay run-matrix --help` or inspect
the machine-readable operation registry at `GET /meta`.

## Results and evidence

Runs preserve the selected map revision, target, modifier values, screenshot policy, actions,
assertions, frames, UI trees, logs, network summaries, performance data, and failure provenance.
Unsupported or denied channels remain visible instead of silently appearing successful.

```text
runs/<iso>_<action>_<device>_<id8>/
  run.json
  evidence.json
  log.txt
  frames/001.png …
```

Large matrices are reviewed screen-first: a 7 × 10 run appears as ten logical screen sections with
seven variants in each, rather than a flat wall of 70 unrelated images. Reports can be shared with
an expiring, revocable, signed link. Public projections exclude selectors, logs, request bodies,
private inputs, and device identifiers.

There is no separate screenshot-crawl project in the desktop app. The App Map remains the source of
truth, the run matrix performs the multiplication, and screenshots plus accessibility trees appear
as evidence on that map-bound run. Internal capture commands may collect the same artifacts for CLI
automation, but they do not create another authoring model.

```bash
pnpm relay run share create <run-id> \
  --input '{"expiresInHours":24,"includeBatch":true}' --json
pnpm relay run share list <run-id> --json
pnpm relay run share revoke <run-id> <share-id> --json
```

Three higher-risk collectors stay off until explicitly enabled in **Settings → Privacy & evidence**:
network bodies, audio probes, and crash diagnostics. Redaction is a separate workspace policy and
applies before persistence and transport; finalized run artifacts are immutable.

## Architecture

```text
desktop · app · CLI · TUI · MCP
              │
       authenticated client
              │
   server · operations · SSE · leases
              │
     protocol → core domain
              │
 browser · Android · iOS adapters
```

| Package           | Responsibility                                                     |
| ----------------- | ------------------------------------------------------------------ |
| `@relay/protocol` | Canonical operations, schemas, actors, resources, and events       |
| `@relay/core`     | App Maps, authoring, execution, evidence, and target adapters      |
| `@relay/server`   | Project-scoped HTTP/SSE, operation dispatch, leases, and artifacts |
| `@relay/client`   | Validated HTTP operations and reconnecting event stream            |
| `@relay/cli`      | Server-first interface for people, scripts, CI, and agents         |
| `@relay/mcp`      | Capability-scoped MCP adapter with native PNG observations         |
| `@relay/tui`      | Terminal workspace                                                 |
| `@relay/ui`       | Host-independent Solid design system                               |
| `@relay/app`      | Host-independent product UI                                        |
| `@relay/desktop`  | Sandboxed Electron host                                            |

Domain behavior stays in `core` and is reached through the registered operation boundary. The
renderer never imports Electron, and `@relay/ui` has no host knowledge. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for concurrency, evidence, security, and target invariants.

## Develop and verify

```bash
vp install
vp check
vp test
pnpm run verify
```

`pnpm run verify` runs formatting/lint checks, the source-size ratchet, type checks, package tests,
UI-boundary checks, and app/desktop production builds. Hardware smoke tests are deliberately
separate:

```bash
pnpm test:golden          # skips cleanly when no supported target is available
pnpm test:golden:require  # fails unless the real-device path succeeds
```

To inspect the exact Electron renderer rather than a browser approximation:

```bash
pnpm dev:desktop
pnpm inspect:desktop
```

The inspector writes a screenshot and a JSON report containing console errors, layout overflow,
and accessible controls.

## Security and collaboration

- Local desktop requests are trusted administrators; remote service tokens receive one explicit
  project role: `viewer`, `author`, `runner`, or `admin`.
- Non-loopback HTTP requires both a bearer token and evidence redaction.
- Control requires an exclusive device lease; observation remains shareable.
- Consequential operations append a payload-safe, attributed Activity event.
- Activity export includes canonical NDJSON records and a SHA-256 integrity manifest.
- Agent proposals cannot silently replace approved maps or visual baselines.

```bash
export RELAY_URL=http://127.0.0.1:8787
export RELAY_ORGANIZATION_ID=local
export RELAY_PROJECT_ID=default
export RELAY_ACTOR_ID=human:terminal

pnpm relay activity export --json > relay-activity.json
```

For remote serving, configure a long random `RELAY_AUTH_TOKEN`, `RELAY_AUTH_ROLE`, and allowed
project IDs. Keep the default loopback binding for ordinary desktop development.

## More documentation

- [Architecture](./ARCHITECTURE.md)
- [Product flows](./docs/PRODUCT_FLOWS.md)
- [Recording format](./docs/RECORDING_FORMAT.md)
- [Evidence metrics](./docs/evidence-metrics.md)
- [Enterprise readiness](./docs/ENTERPRISE_READINESS.md)
- [MCP adapter](./packages/mcp/README.md)

Relay intentionally does not ship enterprise-shaped placeholder UI. A capability is considered
real only when its lifecycle, permissions, failure states, persistence, and evidence are implemented
and tested.
