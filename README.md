# Relay

## Your coding agent says it’s done. Relay proves it.

The agent says it fixed the bug. The diff looks plausible. But nobody proved the affected
user journey on the exact build, so "looks done" ships instead of "proven done."

Relay is the local-first trust layer for turning AI-authored changes into reproducible runtime
proof across web, Android, and iOS. It selects explained user journeys, binds exact
source/build/target identities, replays reviewed Tests, and retains immutable evidence—such as
screenshots, UI trees, actions, assertions, and failure provenance—for a deterministic merge
decision. End-to-end build and execution orchestration remains explicit work in progress; terminal
Proof publication is durable and opt-in through the server's GitHub Checks configuration.

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

| Loop edge                                                                                                                                    | Status      |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Immutable, versioned Proof lifecycle; explained Verification Plan compiler; authoring, replay, repair, evidence, and source-revision binding | **Shipped** |
| Active-workspace diff resolution and durable, exact-revision GitHub check publication                                                        | **Shipped** |
| Automatic build ingestion and server-owned execution expansion                                                                               | **Pending** |

[docs/PR_PROOF_CI.md](./docs/PR_PROOF_CI.md) shows the copy-paste CI wiring available today.

For direct server publication, set both `RELAY_GITHUB_REPOSITORY=owner/repository` and a
GitHub Checks-capable `RELAY_GITHUB_TOKEN`. `RELAY_PROOF_DETAILS_URL` is optional. A terminal Proof
and its publication intent commit together; provider failures remain visible and retry after restart.

Once the loop is trustworthy, **Repeat** applies the same Test across languages, themes, accounts,
devices, builds, or other selected states—without turning every case into a separate Test. A Run
preserves the exact Test, actions, checks, screenshots, UI trees, logs, and failure provenance used
to produce it.

Relay is pre-release software. It is a strong fit for local and self-managed device workflows; it
is not a Relay-managed cloud device farm or a turnkey enterprise SaaS product.

## Who Relay is for

| Good fit today                                                                      | Why                                                                                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| QA, SDET, and platform teams with browsers, attached devices, or a local device lab | Record real product behavior, replay reviewed paths, and retain evidence instead of relying on ad-hoc manual checks. |
| Product and engineering teams verifying web, Android, or iOS builds                 | Run a focused regression or a state matrix against the targets they already control.                                 |
| Teams using coding agents around real devices                                       | The desktop app, CLI, TUI, and MCP adapter use the same project-scoped workflows, policy, and evidence store.        |
| Privacy-sensitive or local-first teams                                              | The normal desktop path runs a loopback Relay service and keeps the control plane and evidence in the project.       |

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

With a Device connected, the first useful workflow is:

1. Press **Record Test** and use the app through Relay.
2. Add a **Checkpoint** where the product state matters.
3. Stop, remove accidental actions, and replay the proposed Test.
4. Approve the reviewed Test, then run one representative case.
5. Read the Report's screenshots, UI trees, actions, assertions, and evidence completeness.
6. Choose **Repeat this…** only when the representative case proves the path.

Relay fails unresolved steps and changed destinations visibly rather than silently guessing a new
route. See [Product flows](./docs/PRODUCT_FLOWS.md) for the complete authoring path.

## What it does

| Capability                | What it gives you                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Record and review**     | Turn Device interactions into one readable Test, clean up accidental actions, replay it, and approve only proven behavior.                                  |
| **Tests and Checkpoints** | Express intent, checks, extraction, human pauses, decisions, loops, reusable modules, and constrained scripts without hand-authoring topology.              |
| **Repeat**                | Apply one Test across selected languages, themes, accounts, builds, Devices, or models. Run one representative case, then resume only the cases you choose. |
| **Runs and Reports**      | Review immutable proof per Run or across a Checkpoint-first Repeat matrix, with baselines, completeness, and first-failure provenance.                      |
| **People and agents**     | Desktop, CLI, TUI, and MCP use the same policy-controlled workflows and canonical operation registry.                                                       |

The ordinary product vocabulary is **Change**, **Proof**, **App**, **Target**, **Test**,
**Checkpoint**, **Run**, and **Report**. **Record**, **Repeat**, **Explore**, and **Verify** are actions. Map is a generated
topology view; internal graph, scheduling, control, and recovery terms appear only in advanced
diagnostics when they are needed.

## Local-first, self-managed

Relay keeps the control plane and evidence in your project: desktop and CLI workflows run against
targets you operate, remote serving is self-managed (bearer token, redaction, explicit scopes), and
evidence sharing is expiring, revocable, and redacted. It is not a hosted cloud-device service—see
[External identity](./docs/EXTERNAL_IDENTITY.md) and [Enterprise readiness](./docs/ENTERPRISE_READINESS.md).

## CLI and automation

The desktop app is the easiest starting point. For scripts and terminal users, use the outcome
commands first:

```bash
pnpm relay connect
pnpm relay record "Settings localization" --confirm
pnpm relay run settings-localization
pnpm relay repeat settings-localization --each language=en,ja,pt-BR
pnpm relay export-evidence <run-id>
pnpm relay verify-change revision <git-sha>
```

These commands resolve the sole connected Device and current Test workspace. The first Record
creates its backing topology automatically; `--device` or the advanced `--map` option is needed only
when selection is ambiguous. Repeat runs one representative pilot and returns a durable,
server-owned `workflowId` plus its optimistic `expectedVersion`; after review, continue the
remaining values with
`pnpm relay continue-repeat <workflow-id> <expected-version> --confirm`. The identifier is not an
authorization credential: project role, Device control, and version checks remain authoritative.
Raw operation invocation and the older command families remain available as an advanced surface.

For an outcome command using the implicit local URL, the CLI safely starts or reuses the local Relay
service and verifies its identity. Explicit `--server` or `RELAY_URL` endpoints and every advanced
command remain caller-managed. Use `pnpm relay --help` to discover the outcome commands or family
help such as `pnpm relay test --help` for advanced operations. JSON results are written to stdout;
waits and diagnostics are written to stderr. The
[MCP adapter](./packages/mcp/README.md) exposes the same outcome workflows to agents by default.

### What failures look like

Advanced commands and explicit endpoints talk to a caller-managed Relay service. If no service is
running on that URL, the request fails at the network layer and the CLI reports it as a connection
failure with exit code `3`:

```text
$ pnpm relay device list --json
relay: fetch failed
```

```json
{
  "type": "error",
  "ok": false,
  "operationId": "system.health.get",
  "error": { "message": "fetch failed", "exitCode": 3 }
}
```

(Use `pnpm ensure:serve` to start or repair a caller-managed local service, then retry.)

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

Every consequential operation is attributed. A Run freezes the selected Test and generated topology
revision, Device, Repeat selection, evidence policy, actions, assertions, frames, UI trees, logs,
and failures.
Finalized artifacts are immutable. Network bodies, audio probes, and crash diagnostics stay off
until a user enables them; redaction is applied before persistence and transport.

`pnpm relay export-evidence <run-id>` exports that persisted Run as a portable, content-addressed
TracePack. Relay verifies the manifest and every embedded object before offline analysis, reports
missing or degraded channels as partial, and always leaves future target behavior unknown. The
analysis may prove what the frozen evidence showed and propose the smallest live replay needed; it
cannot manufacture a future-device pass.

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
- [Repeat a Test across languages](./docs/LANGUAGE_SWEEP_LOOP.md)
- [Recording format](./docs/RECORDING_FORMAT.md)
- [Evidence metrics](./docs/evidence-metrics.md)
- [Enterprise readiness](./docs/ENTERPRISE_READINESS.md)
- [PR proof in CI](./docs/PR_PROOF_CI.md)

Relay does not add enterprise-shaped placeholder UI. A capability is considered real only when its
lifecycle, permissions, failure states, persistence, and evidence are implemented and tested.
