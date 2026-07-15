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

## API surface

- `GET /health` `/meta` `/events` (SSE)
- `GET /devices` `/actions` `/jobs` `/jobs/:id`
- `GET/POST /targets`, `DELETE /targets/:id`, `POST /targets/:id/open`, and
  `POST /targets/:id/preflight`
- `GET /recipes` `/recipes/:id`, `GET /recipes/:id/yaml`, and `POST /recipes/import`
- `GET/POST /suites`, `PUT/DELETE /suites/:id`, `/suites/:id/history`, `/restore`, and `/run`
- `GET/POST /projects` `/builds` `/device-pools` `/device-leases` `/matrices`
- `GET /target-profiles` and `POST /matrices/:id/resolve` for frozen compatibility previews
- `GET/PUT /project/variables` and `/recipes/:id/journey` with revision conflicts
- `POST /generate` through provider-neutral adapters
- `POST /recipes/:id/evidence` + `GET /recipes/:id/evidence/:evidenceId` persist recorder
  screenshots beside recipes without embedding base64 in recipe JSON
- `POST /jobs` `{ action, serial?, … }` → 202 job
- `POST /actions/:id/run` → wait for job (compat)
- `GET /snapshot` `/screenshot`
- `POST /interact` `{ kind: label|point|ref|find|text-match, … }`
- `POST /device/select`

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

## Target boundary

`core/targets.ts` owns target definitions, isolated browser profiles, and preflight checks.
`core/browser-target.ts` adapts Playwright to the existing device contract while the canonical
recipe IR stays independent of Playwright and agent-device. A run freezes target preflight,
performance, screenshots, logs, network activity, and video into immutable evidence. Managed
browser profiles live under `.relay/browser-profiles/` and never reuse personal browser data.
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
