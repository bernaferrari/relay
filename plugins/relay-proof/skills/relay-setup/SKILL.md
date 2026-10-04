---
name: relay-setup
description: Connect Relay for app testing, diagnose an unreachable service or incompatible tools, or capture the first screen without a model.
---

# Connect Relay

If the host exposes no Relay tools, follow the plugin README's connection
setup using the installed connector executable with `--profile qa` and the
intended service or workspace. Its `--help` works offline. For a manually
configured connection, verify that same profile before using the QA tools below;
the executable's no-flag operator default exposes different tool names.

1. Read `relay://guides/start` and `relay://guides/agents`. These guides ship
   with the MCP connector and remain readable while the service is offline.
2. Call `relay_health`. If the service is unavailable, run `relay-mcp doctor --profile qa`
   in the host's configured environment and follow its failed check's next
   action. With the matching `@relay/runtime` candidate installed, configure
   an explicitly chosen absolute `--workspace` directory to attach or launch
   its canonical local service. Use `--runtime-port` when the default is occupied.
   An explicit `--server` or `RELAY_URL` keeps attachment to that endpoint.
   Store the workspace outside plugin caches; browser engines and native
   tools remain target prerequisites. Doctor is read-only and never launches.
3. Call `relay_panel` to list Apps, then call it with the selected `appMapId`
   to find that App's saved Tests and recent Runs. It returns read-only state
   even when the host cannot render a panel. For detailed Test steps, read
   `relay://app-maps/<appMapId>/tests/<testId>` using the returned exact IDs.
4. Call `relay_connect_target`. Select a returned ready target explicitly when
   several exist. Keep its identity throughout the task. Resolve unavailable
   pairing, unlock, or control prerequisites before recording.
5. Call `relay_observe_target` for that target. Completion is an actual
   captured frame with its evidence reference, or the specific reported
   missing prerequisite. A healthy connection alone is not a tested app.

Credentials belong in the host process environment. Use its authorized
organization/project and a distinct `agent:<name>` actor. Another actor's
control or an active Run requires waiting or authorized cancellation.
Installing this local connector does not establish web/mobile host support.
