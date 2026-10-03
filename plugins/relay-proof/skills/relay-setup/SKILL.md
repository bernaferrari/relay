---
name: relay-setup
description: Connect Relay for app testing, diagnose an unreachable service or incompatible tools, or capture the first screen without a model.
---

# Connect Relay

1. Read `relay://guides/start` and `relay://guides/agents`. These guides ship
   with the MCP connector and remain readable while the service is offline.
2. Call `relay_health`. If unavailable, run `relay-mcp doctor --profile qa`
   in the host's configured environment and follow its failed check's next
   action. With the matching `@relay/runtime` candidate installed, configure
   an explicitly chosen absolute `--workspace` directory to attach or launch
   its canonical local service. Use `--runtime-port` when the default is occupied.
   An explicit `--server` or `RELAY_URL` keeps attachment to that endpoint.
   Store the workspace outside plugin caches; browser engines and native
   tools remain target prerequisites. Doctor is read-only and never launches.
3. Call `relay_connect_target`. Select a returned ready target explicitly when
   several exist. Keep its identity throughout the task. Resolve unavailable
   pairing, unlock, or control prerequisites before recording.
4. Call `relay_observe_target` for that target. Completion is an actual
   captured frame with its evidence reference, or the specific reported
   missing prerequisite. A healthy connection alone is not a tested app.

Credentials belong in the host process environment. Use its authorized
organization/project and a distinct `agent:<name>` actor. Another actor's
control or an active Run requires waiting or authorized cancellation.
Installing this local connector does not establish web/mobile host support.
