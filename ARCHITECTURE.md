# Architecture — app testing shell

Product UI work also follows [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md). `@relay/ui` owns semantic
tokens and shared primitives; product components use Tailwind utilities for ordinary styling.

Inspired by OpenCode v2, adapted for **local-first app testing** across managed browsers and
connected mobile devices (not a coding agent).

```
┌──────────────────────────────────────────────────────────────┐
│  HOSTS                                                        │
│  desktop (Electron) │ app (Solid web) │ cli │ tui             │
└─────────┬──────────────────┬──────────────────┬──────────────┘
          │       authenticated @relay/client │ in-process
          ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│  server — scoped resources, jobs, device leases, SSE bus      │
└─────────────────────────────┬────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ protocol → core — target-neutral IR, execution, evaluation      │
└─────────────────────────────┬────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ target adapters — managed browser │ Android/iOS agent-device  │
└──────────────────────────────────────────────────────────────┘
```

## OpenCode patterns we mirror

| OpenCode              | Relay (app testing)                                |
| --------------------- | -------------------------------------------------- |
| Sessions + runner     | **Test jobs** (`enqueueJob` / queue / history)     |
| SSE / event sync      | **`GET /events`** + in-process `publish/subscribe` |
| Command palette       | **⌘K** command registry in `app`                   |
| Platform injection    | **`Platform`** for web vs Electron                 |
| Thin hosts / fat core | Domain only in **`core`**                          |
| Default TTY → TUI     | **`relay`** opens testing TUI                      |
| Inspector-like UI     | **UI snapshot tree** + **screenshot** tabs         |
| Theme JSON            | **`ui` themes** (grok / dracula / nord)            |

## Packages

| Package           | Role                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `@relay/core`     | Tests/YAML, suites, matrix resolver, action catalog, job sessions, snapshot/screenshot/interact |
| `@relay/protocol` | Canonical connections, revisions, suites, resources, generation, and event schemas              |
| `@relay/client`   | Authenticated project-scoped HTTP and fetch-streamed SSE client                                 |
| `@relay/server`   | HTTP + SSE over core                                                                            |
| `@relay/cli`      | Host: TUI default, interactive, serve, direct actions                                           |
| `@relay/tui`      | Terminal testing workspace                                                                      |
| `@relay/ui`       | Solid design system + themes                                                                    |
| `@relay/app`      | Solid product UI (workspace / inspector / screen / activity)                                    |
| `@relay/desktop`  | Electron shell                                                                                  |

## Operation contract

`packages/protocol/src/operations.ts` is the canonical, versioned description of every public
domain operation. Each descriptor owns its stable ID, runtime input and output parsers, HTTP
transport, safety confirmation, target capabilities, lease requirement, idempotency, progress, and
cancellation metadata. It contains data only and sits below the protocol barrel; it never imports a
server handler or renderer callback.

`@relay/server` binds incoming requests to those descriptors and validates both sides of the
existing handler boundary. `GET /meta` is generated from the same registry, so CLI and MCP adapters
can discover capabilities without scraping routes. `@relay/client.invoke(id, input)` derives the
request and validates successful responses; malformed server output becomes `ApiError(502)`.
High-frequency named client methods are small conveniences over `invoke`, not independent
contracts. The app command palette can adapt an operation with `operationCommand`; visual-only
commands such as zoom and panel visibility remain local.

Public authoring vocabulary is **Journey**, **Screen**, **Connection**, **Take**, **Collection**,
**Run**, and **Target**. HTTP authoring resources therefore use `/journeys` and `/collections`.
`Recipe` and `Suite` may remain names for internal execution/storage structures but must not leak
through a host contract. Non-operation resources are deliberately narrow: SSE events, live video,
and immutable run/evidence artifacts. They use `RelayClient.resource`; all product mutations use an
operation.

## Rules

1. Domain logic stays in `core`.
2. UIs consume **jobs + events**, not ad-hoc synchronous-only calls (except CLI direct mode).
3. Renderer never imports `electron`.
4. `ui` has zero host knowledge.
5. `vendor/opencode` is reference-only.
6. Hosts use `@relay/client`; transport shapes live in `@relay/protocol`.
7. Shared product state is server-owned and revisioned; browser storage is for preferences only.
8. Recipes remain target-neutral. Browser and mobile adapters implement the same control and
   observation contract; unsupported capabilities fail explicitly.
9. Git-tracked `tests/*.relay.yaml` is the canonical editable source. Legacy local JSON remains
   readable only for migration; a matching YAML definition always wins.
10. Compatibility matrices select only observed target profiles and preserve every exclusion reason.
11. Desktop update feeds, signatures, and installation stay in Electron's main process. The shared UI
    receives only a typed update state and can request a check or restart after download.
12. Tests are canonical library assets. Suites store ordered references, not copies; every suite run
    freezes its exact suite revision, test revisions, target, and inputs before enqueueing work.

## Actor, command, and event invariants

Every registered request carries one canonical command identity: actor ID and kind, organization,
project, operation, request, timestamp, and idempotency key. The server validates that identity at
the operation boundary and installs it in async-local context before core code runs. Local desktop,
TUI, CLI, and future MCP callers use this same path; “local” is a trust scope, not an alternate
mutation implementation.

Core publishes only versioned event envelopes. The envelope retains the command's actor,
operation, request, correlation, causation, authoring-session, and lease identity while its payload
describes the domain event. SSE assigns monotonic cursors, replays from `Last-Event-ID`, reports a
typed gap when its bounded window cannot satisfy a cursor, and clients deduplicate before
projection. A gap refreshes the client's scoped projections; it never changes local UI focus.

Journey and Collection writes use their persisted `updatedAt` value as the expected revision,
serialize competing writes, and atomically rename a complete temporary file into place. A stale
write receives `409` with the current resource, while replaying an idempotency key returns the
original result without emitting another resource mutation.

## Journey graph document

`JourneyMetadata` schema v6 is the authoring document for the desktop canvas. It deliberately keeps
three concerns separate:

| Concern                                            | Owner                                            | Purpose                                                 |
| -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| Screens, connections, flow starts, layout, notes   | Revisioned Journey document                      | The FigJam-like authoring surface                       |
| Authoring Session, Take revisions, replay history  | `core/authoring-sessions.ts`                     | Shared lifecycle for humans, agents, CLI, and UI        |
| Live target control and capture                    | Server Authoring Session routes + explicit lease | One attributable device-control path                    |
| Recorder controls and review                       | `app/context/recorder.tsx` projection            | A thin view of server state; never lifecycle authority  |
| Semantic screen identity                           | `core/screen-identity.ts`                        | Stable matching across recording, discovery, and replay |
| Recipe steps, graph connection, immutable evidence | `core/journey-aggregate.ts`                      | One recoverable atomic visibility point                 |

Review commits through one core service. It verifies the expected Journey and Recipe revisions,
resolves the observed destination, assigns stable executable step IDs, preserves content-addressed
evidence, and writes the Recipe plus graph connection as one fsynced aggregate rename. A connection
therefore cannot become visible before its steps and evidence are durable. A crash before the rename
returns the Session to review; a crash after it completes the Session from the committed aggregate.
Only the server emits the final `authoring.committed` event. Renderer signals and progress UI are
projections of persisted Session state.

Legacy metadata remains readable. `ensureJourneyGraph()` performs a pure, lazy v5-to-v6 view
migration and `withJourneyGraph()` writes the canonical version only after an intentional canvas
edit. This keeps opening an older recording non-destructive. `journey-document.ts` uses nested
Yjs map/array structures behind the same document seam, so a later provider can synchronize screens
and transitions without moving recipe execution into the renderer.

## Target boundary

`core/targets.ts` owns target definitions, isolated browser profiles, and preflight checks.
`core/browser-target.ts` adapts Playwright to the existing device contract while the canonical
recipe IR stays independent of Playwright and agent-device. A run freezes target preflight,
performance, screenshots, logs, network activity, and video into immutable evidence. Managed
browser profiles live under `.relay/browser-profiles/` and never reuse personal browser data.
Target focus belongs to each client and is never published as shared selection. Every observation
or control operation carries an explicit target context. Control additionally requires an active
lease owned by the command actor; the lease ID is retained on resulting events. Core target code
does not inspect or mutate target-selection environment variables, so concurrent human and agent
operations cannot retarget each other or a queued background run.
`POST /targets/:id/open` always launches a headed browser for human login, MFA, consent, or other
setup. Closing that session flushes the isolated profile; future UI, CLI, scheduled, and matrix
runs reuse it. Direct attachment to a personal browser profile is intentionally not the default
because it is nondeterministic and may expose unrelated browsing data.

## Traces, heal, runs/, overlays

| Concern                | Module                                               |
| ---------------------- | ---------------------------------------------------- |
| Glyph plans per recipe | `core/trace.ts` → `RECIPE_TRACE_PLANS`               |
| Job steps + heal retry | `core/session.ts` → `retryJob`, status `healed`      |
| Disk layout            | `core/runs.ts` → `runs/<ts>_<action>_<device>_<id>/` |
| Snapshot bounds        | `core/workspace.ts` → `captureSnapshot().bounds`     |
| Stage overlays         | `app/components/stage.tsx` → `.hit-rect`             |

SSE events include `job.step`, `job.frame`, `job.healed` in addition to queue lifecycle events.

## Evidence, storage, and transport ownership

Every terminal schema-v5 run commits once: report files are written and synced, then `.complete` is
renamed as the commit point. `core/run-catalog.ts` indexes only committed manifests in a rebuildable
SQLite catalog; artifact files and manifests remain authoritative. Run/job list endpoints return
protocol summaries, while detail and artifact routes resolve one exact run.

`core/run-evidence.ts` owns the run-scoped evidence manifest. Input, screenshots, UI trees, logs,
network summaries, performance, and video are automatic where supported. Network bodies,
time-bucketed audio probes, and crash diagnostics require an explicit workspace consent grant;
the policy is frozen before collectors start. Native crash collection uses Android's crash log
buffer, iOS Simulator unified logs, or physical-device system crash reports. Browser request and
response bodies are bounded per response. Unsupported adapters remain visible as unsupported
channels rather than silently succeeding. Redaction runs before disk and HTTP serialization.

The default-off redaction policy is persisted at `.relay/privacy.json`, can be locked with
`RELAY_REDACTION_MODE`, and cannot be disabled on a non-loopback server binding. CLI and in-process
TUI hosts load the same policy before collecting evidence. Sensitive collector consent is separate
and persisted at `.relay/evidence.json`; it defaults to no grants.

`@relay/protocol` is canonical for summaries, traces, evidence, metrics, and endpoint contracts.
`server/sse.ts` owns event-client lifecycle and `server/scheduler.ts` owns schedule timers. The app's
`context/server.tsx` remains a compatibility composition façade; resource requests live in the
focused `lib/server-*-remote.ts` modules and privacy, target, run, capture, and discovery
controllers. The façade is retained
because it coordinates reconnection order and platform preference restoration; new transport DTOs
must not be added there.

Authoring composes an 82-line `step-row.tsx` shell with target/assertion, interaction, flow/control,
and device/observability editor families. `runs-workspace.tsx` owns the complete report-tab
lifecycle. Pure presentation, URL construction, capture, orchestration, and review calculations
remain extracted and tested under `app/src/lib`.
