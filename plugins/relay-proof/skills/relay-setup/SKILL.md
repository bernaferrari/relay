---
name: relay-setup
description: Connect Relay for app testing, diagnose an unreachable service or incompatible tools, and get to a first verdict.
---

# Connect Relay

If the host exposes no Relay tools, follow the plugin README to configure the
installed connector executable (`qa` is its default profile; the plugin passes
`--profile qa` explicitly) with the intended service or workspace. Its
`--help` works offline.

1. Read `relay://guides/start` and `relay://guides/agents`. They ship with the
   connector and stay readable while the service is offline.
2. Call `relay_health`. If the service is unavailable, run
   `relay-mcp doctor --profile qa` in the host's environment and follow its
   failed check's next action. With the matching `@relay/runtime` installed,
   an explicit absolute `--workspace` attaches to or launches the local
   service (`--runtime-port` when the default is taken). An explicit
   `--server` or `RELAY_URL` keeps that endpoint. Doctor never launches.
3. Call `relay_panel` to list Apps, Tests and recent Runs.
4. Call `relay_connect_target`; pick a ready target explicitly when several
   exist and keep its `targetId`.
5. First verdict: `relay_create_test` with a sentence and the `url` or `app`,
   then the returned `relay_run_test` call. Running steps written from words
   needs a model key (`OPENROUTER_API_KEY` or one saved in Settings); without
   one, record the Test instead (`relay-debug-and-record`).

Credentials belong in the host process environment. Use a distinct
`agent:<name>` actor. Another actor's control or an active Run means waiting
or authorized cancellation. A healthy connection alone is not a tested app.
