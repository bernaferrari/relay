# Relay MCP

`@relay/mcp` gives MCP clients a project-scoped view of Relay through the same server operations used
by the app and CLI. It uses the MCP v2 stdio transport only; stdout is reserved for MCP protocol
messages and diagnostics go to stderr.

## Configure a client

Run the package from this workspace and pass an explicit Relay scope and agent identity:

```json
{
  "mcpServers": {
    "relay": {
      "command": "pnpm",
      "args": [
        "--filter",
        "@relay/mcp",
        "start",
        "--",
        "--server",
        "http://127.0.0.1:8787",
        "--organization",
        "acme",
        "--project",
        "mobile-app",
        "--actor",
        "agent:mcp:qa",
        "--profile",
        "control",
        "--credential-source",
        "env:RELAY_AUTH_TOKEN"
      ],
      "env": {
        "RELAY_AUTH_TOKEN": "${RELAY_AUTH_TOKEN}"
      }
    }
  }
}
```

Set `RELAY_AUTH_TOKEN` in the environment that launches the MCP client. Never place a literal token
in client configuration, arguments, logs, or prompts. For an unauthenticated local Relay server use
`--credential-source none`. The equivalent `RELAY_URL`, `RELAY_ORGANIZATION_ID`,
`RELAY_PROJECT_ID`, `RELAY_ACTOR_ID`, `RELAY_CREDENTIAL_SOURCE`, and `RELAY_TIMEOUT_MS` environment
variables are also supported, but organization, project, and actor identity should always be chosen
deliberately.

## Tool profiles

Relay advertises a role-sized tool set instead of sending every operation to every agent. Select one
with `--profile <name>` or `RELAY_MCP_PROFILE`; the default is the compact `control` profile.
Choose `test` when one agent should read, create, propose, compile, run, cancel, and inspect evidence
for graph-native Tests without loading the complete `full` catalog.

| Profile   | Intended use                                                               |
| --------- | -------------------------------------------------------------------------- |
| `control` | Default direct target observation, input, recovery, and lease management   |
| `map`     | Discovery and observation proposals without full authoring edits           |
| `observe` | Read-only project, device, App Map, proposal, run, and evidence inspection |
| `author`  | Default App Map editing, device recording, and proposal creation           |
| `test`    | Graph Test creation, review, compilation, one-pass runs, and evidence      |
| `run`     | Test/Combine execution, jobs, and run evidence                             |
| `execute` | Alias of `run` for execution-focused agents                                |
| `locale`  | Language Variables, profiles, Combine campaigns, and analysis              |
| `review`  | Proposal/take repair, replay, approval, and run-baseline review            |
| `admin`   | Workspace policy, projects, targets, schedules, matrices, and retention    |
| `full`    | Every canonical Relay operation; intended for trusted orchestration only   |

Tools advertise and take operation fields directly. For example, capture a screenshot with
`{"serial":"emulator-5554"}`. Wrapped or alternate input envelopes are rejected. Known operation
contracts expose specific required fields, types, and enums; intentionally generic Relay operations
remain extensible objects and are still validated by the canonical protocol parser before invocation.

## Graph Test loop

Agents and people use the same scenario-only Test contract:

1. Read the current App Map and Test revision; express the goal as stable-ID intent steps.
2. Create once or propose semantic edits for review. Keep missing bindings explicit.
3. Compile and resolve every blocker against its authored step before running.
4. Run the exact saved revision on an explicit Target, then inspect the terminal run and immutable
   evidence rather than inferring success from the request.
5. Repair the failed Test step or mapped Connection, compile again, and rerun only affected Combine
   values when prior passing evidence remains valid.

Connections and Flows are reusable navigation evidence, not alternate Test formats. Full-surface
capture is reserved for stable product-owned pages and keeps its original viewport PNG/tree pairs.
A cross-app App Language destination should be verified as a reversible OS handoff, captured once,
and left with Back; it is not a language-list traversal.

## Repair proposals

Failed-check repair is exposed through operations, not a separate tool family: `run.repair.list`
returns the project's failed-check repair queue (`relay://repairs`), `run.repair.get` reads one
exact failed-check package under `relay://runs/{runId}/checks/{checkId}/repair`, and
`run.repair.propose` / `run.repair.retry` act on it. The `relay_repair_this_failed_connection`
prompt guides diagnosis and replay of one identified connection; every mutation still goes through
the lease, revision, and confirmation rules above.

## Surface and safety model

- Resources expose bounded, sanitized project, App Map, Flow, Run, Authoring Session, Target, and
  observation state under scoped `relay://` URIs. They do not provide arbitrary filesystem reads.
- Tools are generated from Relay's canonical operation registry and invoke Relay through
  `@relay/client`. Mutations keep the configured agent actor identity and Relay's lease, revision, and
  idempotency rules.
- `relay_target_screenshot_capture` returns the current Target screenshot as native MCP `image/png`
  content plus safe metadata. It never exposes Relay host paths.
- Curated prompts guide safe app mapping, failed-connection repair, and Take review. Every prompt
  requires the configured project and the relevant Target, App Map, session, connection, or Take IDs.
- The `relay_author_this_graph_test` prompt keeps Test design, reviewable semantic edits, compiler
  validation, one-pass execution, and immutable evidence inspection inside the compact `test` profile.
- Observation is not mutation permission. Side-effecting and destructive operations require explicit
  user approval; confirmation-protected tools additionally require the literal `confirm: true` field.
- MCP request cancellation is forwarded to the Relay client. A cancelled request does not grant
  permission to retry, take over a lease, or overwrite a newer revision.
- Failed operations return a sanitized structured error with a stable code, HTTP status when known,
  a bounded recovery action, and the current revision when Relay supplies one. Arbitrary response
  bodies, credentials, and host paths are never forwarded.

There is intentionally no MCP HTTP transport in this package. Run the Relay HTTP server separately;
the MCP process is a scoped stdio adapter, not the source of truth.
