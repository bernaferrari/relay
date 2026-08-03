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

Each project has one **App Map**. Its normalized entities are Screens, Screen Variants, Connections,
Actions, Routines, Flows, Runs, Target Results, Baselines, Proposals, Notes, and Activity Events.
Screens are observed application states; Connections describe how one state reaches another; Flows
are reusable paths through the map.

There is no second graph document and no compatibility authoring model. App Map schema v2 is the
only persisted canvas schema. Unsupported persisted schemas are discarded rather than migrated or
inferred. Executable recipes are an internal deterministic YAML projection used by the runner; they
are not an alternate public product model.

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

Internal recipe operations are deliberately excluded from CLI and MCP. Public automation authors and
runs App Map Flows; the compiler owns the private recipe projection.

## State, concurrency, and collaboration

Shared resources are project-scoped, revisioned, and written atomically. Mutations use expected
revisions and idempotency keys; stale writes return the current resource. Stable entity IDs and
field-level operations allow a hosted collaboration provider to be added without changing domain
entities.

Presence, cursors, viewport, and transient activity are ephemeral awareness data. They are never
execution authority and are not persisted in App Maps. Device input and recording require explicit,
visible, exclusive leases; observation remains shareable. Agent mutations default to attributed
Proposals. Identity merges, approved baselines, and verified status require human approval.

## Authoring and execution

The canvas is the primary authoring surface. A recording creates an Authoring Session and immutable
Take evidence. Review can trim, split, replace, replay, or rewrite the proposed Connection. Approval
commits the reviewed Connection to the App Map and compiles its executable action projection.

A run freezes the Flow revision, selected targets, variables, target profiles, comparison regions,
baseline provenance, and evidence policy before enqueueing. Device groups execute independently per
target and retain every Target Result; one target can never overwrite another. Destination mismatch
is a failure even when the input action itself succeeded.

Project variables are shareable, typed values. Private actor values remain outside the shared App Map
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
6. YAML App Map import/export and run artifacts are deterministic, open projections—not hidden
   alternate sources of truth.
7. A partial or failed operation remains inspectable and never silently rewrites approved behavior.

## Development verification

Run `vp check`, `vp test`, and `pnpm run test:packages`. For the exact Electron renderer, run
`pnpm dev:desktop`, then `pnpm inspect:desktop` in another terminal. The inspector captures the real
preload/IPC renderer, a screenshot, console and page errors, layout overflow, and accessible controls.
