# Architecture — app testing shell

Inspired by OpenCode v2, adapted for **Android app testing** (not a coding agent).

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
│ protocol → core — recipes, collaboration state, generation     │
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

| Package           | Role                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `@relay/core`     | Recipes, action catalog, event bus, job sessions, snapshot/screenshot/interact |
| `@relay/protocol` | Canonical connections, revisions, resources, generation, and event schemas     |
| `@relay/client`   | Authenticated project-scoped HTTP and fetch-streamed SSE client                |
| `@relay/server`   | HTTP + SSE over core                                                           |
| `@relay/cli`      | Host: TUI default, interactive, serve, direct actions                          |
| `@relay/tui`      | Terminal testing workspace                                                     |
| `@relay/ui`       | Solid design system + themes                                                   |
| `@relay/app`      | Solid product UI (workspace / inspector / screen / activity)                   |
| `@relay/desktop`  | Electron shell                                                                 |

## API surface

- `GET /health` `/meta` `/events` (SSE)
- `GET /devices` `/actions` `/jobs` `/jobs/:id`
- `GET /recipes` `/recipes/:id`
- `GET/POST /projects` `/builds` `/device-pools` `/device-leases`
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

## Traces, heal, runs/, overlays

| Concern                | Module                                               |
| ---------------------- | ---------------------------------------------------- |
| Glyph plans per recipe | `core/trace.ts` → `RECIPE_TRACE_PLANS`               |
| Job steps + heal retry | `core/session.ts` → `retryJob`, status `healed`      |
| Disk layout            | `core/runs.ts` → `runs/<ts>_<action>_<device>_<id>/` |
| Snapshot bounds        | `core/workspace.ts` → `captureSnapshot().bounds`     |
| Stage overlays         | `app/components/stage.tsx` → `.hit-rect`             |

SSE events include `job.step`, `job.frame`, `job.healed` in addition to queue lifecycle events.
