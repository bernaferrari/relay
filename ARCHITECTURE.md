# Relay architecture

Relay is a local-first application mapping and verification system for people and agents. Product UI
work also follows [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md): `@relay/ui` owns semantic tokens and shared
primitives, while product components use Tailwind utilities for ordinary styling.

```text
desktop (Electron) · web app · CLI · TUI · MCP
                     │
          authenticated @relay/client
                     │
      server — operations · events · leases
                     │
       protocol → runAction → core domain
                     │
 browser · Android · iOS target adapters
                     │
        evidence store → App Map projection
```

## Canonical product model

A project holds one or more **App Maps**. Each App Map’s normalized entities are Screens, Screen
Variants, Connections, Actions, Routines, Flows, Runs, Target Results, Baselines, Proposals, Notes,
and Activity Events. Screens are observed application states; Connections describe how one state
reaches another; Flows are reusable paths through the map.

**App Map is the primary visual authoring model.** The canvas is where people and agents capture
screens, record connections, review Takes, and organize coverage. App Map schema v1 is the only
persisted canvas schema. Unsupported persisted schemas are discarded rather than migrated or
inferred. There is no second graph document and no compatibility authoring surface.

Capture engines may discover screens and collect screenshots or accessibility trees, but they never
own a second product workspace. Their output is projected onto the frozen App Map revision as Run
and Target Result evidence. A language sweep is therefore a matrix run of a mapped test—not a
separate crawl document, gallery, or authoring model.

**Variables** on the App Map are lists (language, theme, location): teach 1–2 rows, infer the rest,
optionally bind a recorded open/leave path. Inference never invents navigation. The protocol
collection has always been `variables`, and the UI and CLI now say the same word.
**Tests** are graph-native intent documents with stable step IDs. Instruction, validation,
extraction, manual checkpoint, module, decision, loop, and constrained-script steps bind to reviewed
App Map entities or remain explicitly unresolved. `scenario` is the only Test contract. Connections
and Flows may satisfy navigation bindings, but neither is an alternate Test document or conversion
source. **Combine** is every selected Variable value × those Tests (one
visible grid, one job), matching the `combines` collection it is stored in. Case stacks
remain typed **test data** expansion (emails, plans), not modes.

**Recipes are compiled executable IR**, not a second authoring surface. A recipe is the
target-neutral, step-oriented contract the runner executes: reusable modules, YAML import/export,
discovery promotion, history/restore, stability signals, and frozen job snapshots. When an App Map
Flow or Connection runs, Relay compiles verified graph steps into recipe IR. People and agents
author App Maps; they do not browse a recipe library.

CLI and MCP hide `recipe.*` CRUD as internal compiled storage. Execution still accepts a recipe id
on `job.start` when a compiled artifact already exists. Selected canvas state (`selectedAppMapId`
and peers) always refers to an App Map id — never a recipe id.

## Packages

| Package           | Responsibility                                                            |
| ----------------- | ------------------------------------------------------------------------- |
| `@relay/protocol` | Canonical operation, entity, event, revision, and evidence schemas        |
| `@relay/core`     | App Map operations, authoring, execution, evaluation, evidence, discovery |
| `@relay/server`   | Project-scoped HTTP, SSE, operation dispatch, leases, and artifacts       |
| `@relay/client`   | Validated HTTP operations and reconnecting event stream                   |
| `@relay/cli`      | Server-first interface for people, scripts, CI, and agents                |
| `@relay/mcp`      | Capability-scoped MCP adapter with native PNG observations                |
| `@relay/tui`      | Terminal workspace                                                        |
| `@relay/ui`       | Host-independent Solid design system                                      |
| `@relay/app`      | Host-independent Solid product UI                                         |
| `@relay/desktop`  | Sandboxed Electron host                                                   |

## One operation boundary

`packages/protocol/src/operations.ts` describes every public domain operation. Each descriptor owns
its stable ID, runtime input/output parser, transport, safety confirmation, capability and lease
requirements, idempotency, progress, and cancellation metadata.

The app, CLI, TUI, MCP adapter, and future SDKs call the same validated operations. The server
installs canonical actor and request identity before calling `runAction`; hosts do not contain private
domain behavior. `GET /meta` is generated from the registry, so machine interfaces discover exact
contracts instead of scraping route documentation. MCP operations accept the direct canonical input
shape only.

Public automation authors App Maps through registered `app-map.*` operations. Tests, Flows, and
Connections compile into recipe IR inside the runner. `app-map.test.run` checks the exact App Map
revision, compiles once, and queues that immutable compiler root as one operation; callers never
need to coordinate a compile result with a generic job request. CLI and MCP do not expose recipe
storage as a host-facing authoring API.

## State, concurrency, and collaboration

Shared resources are project-scoped, revisioned, and written atomically. Mutations use expected
revisions and idempotency keys; stale writes return the current resource. Stable entity IDs and
field-level operations allow a hosted collaboration provider to be added without changing domain
entities.

The control plane persists in `.relay/control.sqlite` (WAL, `busy_timeout=5000`), following the same
`node:sqlite` pattern as the run catalog and OpenCode’s local database: one row per project, build,
pool, matrix, lease, Variable document, idempotency key, and App Map. Nested entities stay JSON
inside that row; leases and catalog lists never rewrite other maps. Existing `collaboration.json`
is imported once and renamed to `collaboration.json.migrated`. Schema changes use `PRAGMA user_version`.
Resource events are written to `control_events` in the same transaction and published to the in-process
bus only after COMMIT and after the writer lock is released. A later online sync adapter can tail that
log; presence is not durable. Subscribers may start another control write.
`relay db` inspects the local file (`path`, `query`, `events`, `shell`) without going through HTTP.
Presence and cursors stay ephemeral. This is not a canvas CRDT — a future Yjs or
Automerge adapter still lands through `AppMapCollaborationDocument` and field-level App Map commits.

Relay does not currently depend on Yjs. The domain now exposes a provider-neutral
`AppMapCollaborationDocument` and typed field-level canvas changes so a future Yjs, Automerge, or
hosted adapter can share notes, groups, screen layout, and connector presentation without changing
the runner. Core stays provider-free: adapters publish granular changes through normal, server-stamped
App Map commits rather than replacing a whole map from a stale CRDT snapshot. Execution graph data,
run artifacts, evidence, and approvals remain authoritative server state and sit outside the live
document. Large screenshot matrices remain evidence references, not replicated binary arrays;
presence and cursors use a separate ephemeral awareness channel rather than persisted map state.

Presence, cursors, viewport, and transient activity are ephemeral awareness data. They are never
execution authority and are not persisted in App Maps. Device input and recording require a visible
server-owned lease. Trusted same-project local clients share the local-project lease while mutations
serialize per Target; remote actors remain exclusive. Observation remains shareable. Agent mutations default to attributed
Proposals. Identity merges, approved baselines, and verified status require human approval.

## Authoring and execution

The canvas is the primary authoring surface. A recording creates an Authoring Session and immutable
Take evidence. Review can trim, split, replace, replay, or rewrite the proposed Connection. Approval
commits the reviewed Connection to the App Map and compiles its executable action projection.

A Test run freezes the App Map and Test revision, compiled step provenance, selected targets,
Variables, target profiles, comparison regions, baseline provenance, and evidence policy before
enqueueing. Device groups execute independently per
target and retain every Target Result; one target can never overwrite another. Destination mismatch
is a failure even when the input action itself succeeded.

Project Variables are shareable, typed values (stored under the protocol's `variables` field).
Private actor values remain outside the shared App Map
and resolve at run time. Matrices can expand values, targets, builds, models, and variants without
duplicating a Flow.

## Target boundary

`core/targets.ts` owns target definitions, isolated browser profiles, and preflight checks. Browser,
Android, and iOS adapters implement the same target-neutral observation and control contract.
Unsupported capabilities fail explicitly.

Every observation and control operation names its target. Control also requires the caller's active
lease. No process-global selected device is execution authority, so concurrent people and agents
cannot silently retarget one another.

Target resolution is deterministic first: stable IDs, accessibility semantics, visible text,
structural relationships, and prior visual anchors precede optional model grounding. Raw coordinates
are an explicit final fallback. Every resolution records method, candidates, confidence, chosen
bounds, and verification result.

## Evidence and Activity

All consequential operations append an Activity Event with actor, source, request, affected entities,
target, duration, outcome, and safe diagnostics. Runs commit synchronized evidence against one
monotonic clock: actions, assertions, frames, UI trees, logs, network summaries, performance, model
decisions, lifecycle events, and failures.

Run artifacts and committed manifests are authoritative; SQLite indexes are rebuildable projections.
Sensitive network bodies, audio probes, and crash diagnostics require explicit consent. Redaction runs
before persistence and transport. Unsupported or denied evidence channels remain visible instead of
silently appearing successful.

## Host and security invariants

1. Domain logic stays in `core` and is reached through registered operations.
2. Renderer code never imports Electron; it only uses the typed preload bridge.
3. `@relay/ui` has no host or domain knowledge.
4. Electron uses context isolation, a sandboxed renderer, no Node integration, and a narrow CSP-bound
   preload API.
5. Local HTTP uses scoped identity. Non-loopback serving requires authentication and redaction.
6. YAML App Map and recipe import/export, plus run artifacts, are deterministic open projections—not
   hidden alternate sources of truth.
7. A partial or failed operation remains inspectable and never silently rewrites approved behavior.

## Development verification

Run `vp check`, `pnpm run check:architecture`, `vp test`, and `pnpm run test:packages`. The architecture
check keeps new components below 700 lines and other source modules below 900. Existing larger
modules have explicit, exact ceilings that may only move downward, so refactors become a permanent
ratchet instead of temporary cleanup. For the exact Electron renderer, run `pnpm dev:desktop`, then
`pnpm inspect:desktop` in another terminal. The inspector captures the real preload/IPC renderer, a
screenshot, console and page errors, layout overflow, and accessible controls.
