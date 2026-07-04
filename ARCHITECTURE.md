# Architecture — app testing shell

Inspired by OpenCode v2, adapted for **Android app testing** (not a coding agent).

```
┌──────────────────────────────────────────────────────────────┐
│  HOSTS                                                        │
│  desktop (Electron) │ app (Solid web) │ cli │ tui             │
└─────────┬──────────────────┬──────────────────┬──────────────┘
          │ HTTP + SSE       │ HTTP + SSE       │ HTTP or in-process
          ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│  server — jobs queue, snapshot/screenshot/interact, SSE bus   │
└─────────────────────────────┬────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  core — agent-device recipes, events, sessions/jobs, workspace │
└──────────────────────────────────────────────────────────────┘
```

## OpenCode patterns we mirror

| OpenCode              | Grok Device (app testing)                          |
| --------------------- | -------------------------------------------------- |
| Sessions + runner     | **Test jobs** (`enqueueJob` / queue / history)     |
| SSE / event sync      | **`GET /events`** + in-process `publish/subscribe` |
| Command palette       | **⌘K** command registry in `app`                   |
| Platform injection    | **`Platform`** for web vs Electron                 |
| Thin hosts / fat core | Domain only in **`core`**                          |
| Default TTY → TUI     | **`grok-device`** opens testing TUI                |
| Inspector-like UI     | **UI snapshot tree** + **screenshot** tabs         |
| Theme JSON            | **`ui` themes** (grok / dracula / nord)            |

## Packages

| Package                | Role                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ |
| `@grok-device/core`    | Recipes, action catalog, event bus, job sessions, snapshot/screenshot/interact |
| `@grok-device/server`  | HTTP + SSE over core                                                           |
| `@grok-device/cli`     | Host: TUI default, interactive, serve, direct actions                          |
| `@grok-device/tui`     | Terminal testing workspace                                                     |
| `@grok-device/ui`      | Solid design system + themes                                                   |
| `@grok-device/app`     | Solid product UI (workspace / inspector / screen / activity)                   |
| `@grok-device/desktop` | Electron shell                                                                 |

## API surface

- `GET /health` `/meta` `/events` (SSE)
- `GET /devices` `/actions` `/jobs` `/jobs/:id`
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
