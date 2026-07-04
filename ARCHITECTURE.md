# Architecture

Inspired by OpenCode v2 layering, scaled down for device automation.

```
┌──────────────────────────────────────────────────────────┐
│  HOSTS                                                    │
│  desktop (Electron) │ app (Solid web) │ cli │ tui         │
└───────────────┬──────────────────┬─────────────┬─────────┘
                │ HTTP             │ in-process  │ HTTP / in-process
                ▼                  ▼             ▼
┌──────────────────────────────────────────────────────────┐
│  server (optional HTTP)  OR  direct @grok-device/core       │
└─────────────────────────────┬────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────┐
│  core — agent-device recipes (Play Store, Grok login)      │
└──────────────────────────────────────────────────────────┘
```

## Packages

| Package                | Role                                                   |
| ---------------------- | ------------------------------------------------------ |
| `@grok-device/core`    | Domain: device SDK helpers, actions catalog, runAction |
| `@grok-device/server`  | Thin Node HTTP over core                               |
| `@grok-device/cli`     | Primary host: interactive, direct, serve, tui          |
| `@grok-device/tui`     | Terminal UI (ANSI menus)                               |
| `@grok-device/ui`      | Solid design system + theme JSON → CSS vars            |
| `@grok-device/app`     | Product UI; host-agnostic via Platform                 |
| `@grok-device/desktop` | Electron main/preload/renderer                         |

## Rules

1. Domain first — ADB/device actions live in `core`.
2. Host owns lifecycle — CLI/desktop start server; UI never forks domain processes without host.
3. IPC only for OS — file pickers, notifications, window chrome.
4. Renderer never imports `electron` — only `window.api`.
5. `ui` has zero knowledge of hosts.
