# Relay

**An AI agent just changed your mobile app. Can you trust what it did?**

The agent says it fixed the bug. The diff looks plausible. But nobody replayed the
critical flow on a real device, so "looks done" ships instead of "proven done."

Relay closes that gap: **prove AI-written mobile code works before merge.**
Relay is a local-first proof layer for agent-written mobile code. It replays reviewed
product flows against browsers, Android devices, and iOS devices that *you* attach, then
attaches immutable evidence—screenshots, UI trees, actions, assertions, failure provenance—
to the result.

The loop Relay exists to close:

```text
PR opened
  → app built
  → critical flow replayed on YOUR devices
  → proof attached to the PR
  → exact failure returned to the agent
  → fix generated
  → affected flow rerun
  → PR passes
```

Where the loop stands today:

| Loop edge | Status |
| --- | --- |
| Authoring (agents propose Tests via MCP/CLI), replay on real targets, repair, evidence, source-revision tagging (`--commit/--pr/--branch`), report emit | **Shipped** |
| Build ingest automation and GitHub check-run posting from CI | **Pending** |

[docs/PR_PROOF_CI.md](./docs/PR_PROOF_CI.md) shows the copy-paste CI wiring available today.

Once the loop is trustworthy, **Variables** and **Combine** let a team apply it across languages,
themes, accounts, devices, builds, or other selected states—without turning every case into a
separate test. A run preserves the map revision, actions, checks, screenshots, UI trees, logs, and
failure provenance used to produce it.

Relay is pre-release software. It is a strong fit for local and self-managed device workflows; it
is not a Relay-managed cloud device farm or a turnkey enterprise SaaS product.

## Who Relay is for

| Good fit today                                                                  | Why                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Mobile QA, SDET, and platform teams with attached devices or a local device lab | Map real product behavior, replay reviewed paths, and retain evidence instead of relying on ad-hoc manual checks. |
| Product and engineering teams verifying web, Android, or iOS builds             | Run a focused regression or a state matrix against the targets they already control.                              |
| Teams using coding agents around real devices                                   | The desktop app, CLI, TUI, and MCP adapter call the same project-scoped operations, leases, and evidence store.   |
| Privacy-sensitive or local-first teams                                          | The normal desktop path runs a loopback Relay service and keeps the control plane and evidence in the project.    |

Relay is not yet the right choice for a team that needs to upload a build to a managed cloud, rent a
device fleet, or buy organization-wide SSO, quotas, and published service-level objectives.

## Start locally

Relay's fastest path is the desktop app. You need Node.js 24 or newer and Corepack. The workspace
installs its pinned pnpm and Vite+ versions, so no global `vp` command is required.
Android work also needs `adb`; physical iOS control needs the local Apple developer tooling used by
[agent-device](https://oss.callstack.com/agent-device/docs/quick-start).

```bash
corepack pnpm install --frozen-lockfile
pnpm doctor
pnpm dev:desktop
```

The Electron app starts one loopback Relay service for the project. No hosted Relay account or cloud
provider is involved in that path.

With a target connected, the first useful workflow is:

1. In **Device**, select the connected browser, Android, or iOS target and save the first useful screen.
2. Record one meaningful transition, remove accidental inputs in Take review, and replay it.
3. Add the reviewed Connection to the **App Map**.
4. In **Tests**, add intent and checks bound to reviewed Connections or saved Flows.
5. Run one pilot and inspect the exact screenshots, UI trees, actions, and assertions before expanding coverage.

Relay fails unresolved steps and changed destinations visibly rather than silently guessing a new
route. See [Product flows](./docs/PRODUCT_FLOWS.md) for the complete authoring path.

## What it does

| Capability                | What it gives you                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App Map**               | Agents propose Screens and Connections; humans review Takes and approve them; Relay proves approved flows by replaying them with evidence. |
| **Graph-native Tests**    | Intent, checks, extraction, manual checkpoints, decisions, loops, reusable modules, and constrained scripts—all bound to the App Map or explicitly marked unresolved.   |
| **Variables and Combine** | Reuse a Test across selected language, theme, account, build, device, or model values. Preview the expansion, run one pilot, then resume only untouched cases.          |
| **Targets**               | A Relay-owned Playwright profile for browsers plus Android and iOS adapters. Target capabilities and unsupported actions are reported explicitly.                       |
| **Evidence and reports**  | Immutable run artifacts, screenshot and UI-tree evidence, logs, failure provenance, visual baselines, and expiring/revocable redacted report links.                     |
| **People and agents**     | Desktop, CLI, TUI, and MCP use the same operation registry. Device control requires a server-managed lease; observation can be shared.                                  |

The product model has five terms: a **Screen** is a product state; a **Connection** is a reviewed
transition; a **Variable** changes one reusable dimension; a **Test** states what should happen; and
a **Combine** runs selected Variables × Tests. This keeps recordings useful as navigation evidence
without making them a second test format.

## Local-first, self-managed

Relay keeps the control plane and evidence in your project: desktop and CLI workflows run against
targets you operate, remote serving is self-managed (bearer token, redaction, explicit scopes), and
evidence sharing is expiring, revocable, and redacted. It is not a hosted cloud-device service—see
[External identity](./docs/EXTERNAL_IDENTITY.md) and [Enterprise readiness](./docs/ENTERPRISE_READINESS.md).

## CLI and automation

The desktop app is the easiest starting point. For scripts, CI, terminal users, or agents, start a
Relay service deliberately and call the same project-scoped API through the canonical CLI entry:

```bash
pnpm ensure:serve
pnpm relay device list --json
pnpm relay map list --json
pnpm relay test compile <map-id> <test-id> --json
pnpm relay test run <map-id> <test-id> --target current --revision current
```

The CLI does not silently start another server. Use `pnpm relay --help` or family help such as
`pnpm relay test --help` to discover the verified command vocabulary. JSON results are written to
stdout; waits and diagnostics are written to stderr. The [MCP adapter](./packages/mcp/README.md)
exposes the same registered operations to capable agents.

### What failures look like

Every command talks to the Relay service over HTTP first. If no service is running on the
configured URL, the request fails at the network layer and the CLI reports it as a connection
failure with exit code `3`:

```text
$ pnpm relay device list --json
relay: fetch failed
```

```json
{"type":"error","ok":false,"operationId":"system.health.get","error":{"message":"fetch failed","exitCode":3}}
```

(Use `pnpm ensure:serve` to start the local service, then retry.)

Device input requires a server-owned lease. When another actor already holds the lease for the
target, the control operation fails closed instead of displacing them:

```text
$ pnpm relay device interact <serial> --input '...'
relay: This target is currently controlled by another actor
Recovery: Observation remains available. Wait for the lease to expire or request an explicit,
audited takeover before sending input.
```

That response carries code `TARGET_CONTROL_LEASE_CONFLICT`, and the CLI maps every
`TARGET_CONTROL_LEASE_*` failure to exit code `6` (conflict). When no lease exists at all, the
server answers `Take control of this target before sending device input`
(`TARGET_CONTROL_LEASE_REQUIRED`) and suggests the exact command, printed as
`Try: relay lease create <serial> --actor <actor-id>`.

One Relay server owns each `RELAY_STATE_DIR`. Starting a second server against the same local state
directory fails before it can recover jobs or touch a device; use `pnpm ensure:serve` to replace the
local service deliberately, or give an isolated worker its own state directory. A state directory
owned by another host also fails closed until a supervised multi-host lease is available.

## Evidence, privacy, and control

Every consequential operation is attributed. A run freezes the selected App Map and Test revision,
target, Variables, evidence policy, actions, assertions, frames, UI trees, logs, and failures.
Finalized artifacts are immutable. Network bodies, audio probes, and crash diagnostics stay off
until a user enables them; redaction is applied before persistence and transport.

Local desktop requests are trusted administrators. Remote service tokens receive one configured
project role (`viewer`, `author`, `runner`, or `admin`). A visible server-owned lease protects device
input so two people or agents cannot silently drive the same target.

## Develop and verify

For browser-only UI development, run the service and product app separately:

```bash
# Terminal 1: explicitly trust the Relay-owned Vite renderer, not every local site.
export RELAY_ALLOWED_BROWSER_ORIGINS="http://127.0.0.1:5173"
pnpm ensure:serve

# Terminal 2
pnpm dev:app
```

Run the normal quality gates with:

```bash
vp check
vp test
pnpm run verify
```

`pnpm run verify` includes formatting, linting, type checks, tests, UI-boundary checks, source-size
ratchets, production app/desktop builds, and a target-native, checksummed iOS preview sidecar.
CI also builds and verifies both Apple Silicon and Intel sidecars.

The packaged macOS desktop build ships a reviewed, pixel-only iOS preview sidecar per target
architecture (Apple Silicon or Intel). Relay verifies the native binary and its source-provenance
manifest at startup; a damaged install asks for a reinstall rather than a substitute tool. Source
checkouts can build the same pinned producer with `pnpm ios-preview:build`.
Hardware golden checks are separate because real hardware is not universally available:

```bash
pnpm test:golden          # skips cleanly when no supported target is available
pnpm test:golden:require  # fails unless the real-device path succeeds
```

If setup behaves unexpectedly, run `pnpm doctor`. To inspect a running Relay service separately,
run `pnpm server:doctor`.

## More documentation

- [Architecture](./ARCHITECTURE.md)
- [Product flows](./docs/PRODUCT_FLOWS.md)
- [Language sweep loop](./docs/LANGUAGE_SWEEP_LOOP.md)
- [Recording format](./docs/RECORDING_FORMAT.md)
- [Evidence metrics](./docs/evidence-metrics.md)
- [Enterprise readiness](./docs/ENTERPRISE_READINESS.md)
- [PR proof in CI](./docs/PR_PROOF_CI.md)

Relay does not add enterprise-shaped placeholder UI. A capability is considered real only when its
lifecycle, permissions, failure states, persistence, and evidence are implemented and tested.
