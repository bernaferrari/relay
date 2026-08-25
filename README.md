# Relay

Relay is a local-first application mapping and verification tool for browser, Android, and iOS
products. It can work without an application's source code: connect a running target, map the
screens and transitions that matter, then replay reviewed tests with durable evidence.

Its core loop is deliberately small:

```text
Connect a target → map screens and connections → author a Test → run a pilot → inspect evidence
```

Once that loop is trustworthy, **Variables** and **Combine** let a team apply it across languages,
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

Each packaged macOS build includes Relay's reviewed, pixel-only iOS preview sidecar for its target
architecture (Apple Silicon or Intel). At startup Relay verifies the native binary and its
source-provenance manifest before using it; a damaged install tells you to reinstall rather than
downloading, building, or substituting another capture/control tool. Source checkouts can build the
same pinned producer deliberately with `pnpm ios-preview:build` when live iOS preview is needed.

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
| **App Map**               | A visual, revisioned record of observed Screens and reviewed Connections. Recorded Takes can be trimmed, replayed, and approved before they become navigation evidence. |
| **Graph-native Tests**    | Intent, checks, extraction, manual checkpoints, decisions, loops, reusable modules, and constrained scripts—all bound to the App Map or explicitly marked unresolved.   |
| **Variables and Combine** | Reuse a Test across selected language, theme, account, build, device, or model values. Preview the expansion, run one pilot, then resume only untouched cases.          |
| **Targets**               | A Relay-owned Playwright profile for browsers plus Android and iOS adapters. Target capabilities and unsupported actions are reported explicitly.                       |
| **Evidence and reports**  | Immutable run artifacts, screenshot and UI-tree evidence, logs, failure provenance, visual baselines, and expiring/revocable redacted report links.                     |
| **People and agents**     | Desktop, CLI, TUI, and MCP use the same operation registry. Device control requires a server-managed lease; observation can be shared.                                  |

The product model has five terms: a **Screen** is a product state; a **Connection** is a reviewed
transition; a **Variable** changes one reusable dimension; a **Test** states what should happen; and
a **Combine** runs selected Variables × Tests. This keeps recordings useful as navigation evidence
without making them a second test format.

## Local, self-managed, and hosted boundaries

| Available now                                                                                                                                                        | Not shipped as a Relay service                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Desktop and CLI workflows against targets you attach, emulate, or otherwise operate.                                                                                 | A Relay-managed cloud-device provider, device rental, or managed fleet scheduler.                                        |
| Project-scoped local storage, immutable evidence, access roles for configured service tokens, and authenticated remote serving when you operate the server yourself. | Hosted multi-tenant control/data planes, multi-node stores, fleet shards, quotas, or published service-level objectives. |
| Expiring, revocable, redacted evidence sharing.                                                                                                                      | SSO/OIDC, managed group-to-role provisioning, and enterprise encryption-policy management.                               |

Remote serving is self-managed: non-loopback HTTP requires a bearer token, evidence redaction, and
an explicit static-token role, organization, and project scope. Browser access is opt-in: set
`RELAY_ALLOWED_BROWSER_ORIGINS` to the exact Relay-owned HTTP(S) renderer origins, or use bearer
authentication. Originless Electron and CLI clients keep the local desktop path. It should not be
read as an offer of a hosted Relay cloud. For an executable remote setup, see
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
$ pnpm relay device tap <serial> --input '...'
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
- [Recording format](./docs/RECORDING_FORMAT.md)
- [Evidence metrics](./docs/evidence-metrics.md)
- [Enterprise readiness](./docs/ENTERPRISE_READINESS.md)
- [MCP adapter](./packages/mcp/README.md)

Relay does not add enterprise-shaped placeholder UI. A capability is considered real only when its
lifecycle, permissions, failure states, persistence, and evidence are implemented and tested.
