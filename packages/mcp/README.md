# Relay MCP

`@relay/mcp` gives MCP clients a project-scoped view of Relay through the same server operations used
by the app and CLI. The published package contains a bundled host-neutral executable, so an agent
host can install it with npm without pnpm or a Relay workspace. Its default MCP v2 transport is
stdio; the reviewed `relay-mcp-bridge` command adapts that same process to Streamable HTTP for
hosts that accept only a remote MCP URL. Stdout is reserved for MCP protocol messages and
diagnostics go to stderr.

## Install and configure a client

For a released host installation, use the host-neutral executable. Codex, Claude Code, and
ChatGPT-compatible MCP bridges all launch this same package; no host has a second Relay schema.
The npm command applies after `@relay/mcp` is published; until then, install the local release
artifact from this checkout:

```bash
npm install --global @relay/mcp@0.1.0 # after the public release
# From this repository before publication:
npm pack --silent ./packages/mcp
npm install --global ./relay-mcp-0.1.0.tgz
relay-mcp doctor --profile proof
```

The plugin descriptor invokes the installed `relay-mcp` binary. A clean host does not need pnpm or
the Relay workspace after the package is installed.

The local defaults use the loopback Relay service, the local project, a process-scoped agent
identity, and the compact outcome tool set. The Proof plugin selects `RELAY_MCP_PROFILE=proof`:

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay-mcp",
      "args": ["--profile", "proof"],
      "env": { "RELAY_MCP_PROFILE": "proof" }
    }
  }
}
```

The executable also exposes a fail-closed setup check. It intentionally reports `NOT READY` when
the Relay service is unavailable, the scope or role is wrong, or the server manifest is missing a
Proof operation:

```bash
relay-mcp doctor --profile proof --json
```

It checks server reachability, organization/project scope, the configured agent identity, the
selected profile's role requirements, human-only plan approval, and every canonical Proof tool in
the server operation manifest. The report never prints `RELAY_AUTH_TOKEN`.

For a remote authenticated service, set `RELAY_AUTH_TOKEN` in the environment that launches the MCP
client and configure its URL and project. Never place a literal token in client configuration,
arguments, logs, or prompts. For an explicitly unauthenticated local Relay server use
`--credential-source none`. The equivalent `RELAY_URL`, `RELAY_ORGANIZATION_ID`,
`RELAY_PROJECT_ID`, `RELAY_ACTOR_ID`, `RELAY_CREDENTIAL_SOURCE`, and `RELAY_TIMEOUT_MS` environment
variables are also supported, but organization, project, and actor identity should always be chosen
deliberately.

## ChatGPT-compatible remote bridge

`relay-mcp-bridge` is a thin, reviewed transport adapter. It starts one `relay-mcp` child per MCP
session and carries newline-framed JSON-RPC messages over an authenticated HTTP endpoint. It does
not define tools, schemas, or Proof behavior; those remain in the child package and the canonical
operation registry.

Run it behind HTTPS when a remote ChatGPT-compatible host needs a URL:

```bash
export RELAY_MCP_BRIDGE_AUTH_TOKEN=…   # bridge credential, supplied by the host
export RELAY_AUTH_TOKEN=…              # Relay credential, kept only in this process environment
export RELAY_URL=https://relay.example
export RELAY_ORGANIZATION_ID=acme
export RELAY_PROJECT_ID=checkout
export RELAY_ACTOR_ID=agent:chatgpt
export RELAY_MCP_PROFILE=proof
relay-mcp-bridge --host 127.0.0.1 --port 8788 --auth-env RELAY_MCP_BRIDGE_AUTH_TOKEN
```

The bridge binds to loopback by default and refuses a public unauthenticated bind. Put a TLS
reverse proxy and its access policy in front of a publicly reachable endpoint; pass the resulting
`https://…/mcp` URL to the host as its remote MCP `server_url`. Configure the host's authorization
secret through its secret/reference mechanism, never by committing it to JSON or a prompt. A
stdio-only host can use the same package directly:

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay-mcp",
      "args": ["--profile", "proof"],
      "env": { "RELAY_MCP_PROFILE": "proof" }
    }
  }
}
```

For a ChatGPT-compatible remote MCP client, select the bridge URL and require approval for
side-effecting tools in the host. Do not recreate the Relay tool list in the host configuration;
the bridge exposes exactly the profile selected by `RELAY_MCP_PROFILE`.

## Tool profiles

Relay defaults to sixteen outcome tools that cover Connect, Observe, Record, Checkpoint, Review,
Replay, Approve, Run, Repeat, failure inspection, repair proposals, and TracePack export. Agents do
not need to select a profile for the normal workflow. Trusted orchestrators can opt into a
lower-level profile with `--profile <name>` or `RELAY_MCP_PROFILE`.

| Profile   | Intended use                                                                              |
| --------- | ----------------------------------------------------------------------------------------- |
| `outcome` | Default Test workflow: connect, observe, record, replay, run, repeat, inspect, export     |
| `control` | Advanced direct target observation, input, recovery, and lease management                 |
| `map`     | Discovery and observation proposals without full authoring edits                          |
| `observe` | Read-only project, device, App Map, proposal, run, and evidence inspection                |
| `author`  | Default App Map editing, device recording, and proposal creation                          |
| `test`    | Graph Test creation, review, compilation, one-pass runs, and evidence                     |
| `run`     | Test/Combine execution, jobs, and run evidence                                            |
| `execute` | Alias of `run` for execution-focused agents                                               |
| `locale`  | Language Variables, profiles, Combine campaigns, and analysis                             |
| `review`  | Proposal/take repair, replay, approval, and run-baseline review                           |
| `admin`   | Workspace policy, projects, targets, schedules, matrices, and retention                   |
| `proof`   | Verify one change: affected flows, runs, proof reports, repair proposals, and share links |
| `full`    | Every canonical Relay operation; intended for trusted orchestration only                  |

Outcome tools accept job-level intent and resolve the sole Test workspace, Device, current revision,
and available control internally. Advanced profile tools advertise and take canonical operation
fields directly. For example, capture a screenshot with
`{"serial":"emulator-5554"}`. Wrapped or alternate input envelopes are rejected. Known operation
contracts expose specific required fields, types, and enums; intentionally generic Relay operations
remain extensible objects and are still validated by the canonical protocol parser before invocation.

## Agent quickstart: verify one flow across languages

Run the Relay service first (`pnpm ensure:serve`), then use the default tools:

1. `relay_connect_target`
2. `relay_observe_target`
3. `relay_record_test` → `relay_record_action` / `relay_add_checkpoint`
4. `relay_stop_recording` → `relay_edit_recording` → `relay_replay_recording`
5. `relay_approve_recording`
6. `relay_repeat_test` to run one pilot
7. `relay_inspect_workflow`, then `relay_continue_repeat` with explicit confirmation
8. `relay_inspect_failure` or `relay_export_evidence`

Every workflow mutation carries the continuation reference and expected version returned by the
previous step. The language variant is documented in
[Repeat a Test across languages](../../docs/LANGUAGE_SWEEP_LOOP.md).

## Advanced graph Test loop

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

Destination-mismatch repair proposals are also exposed as typed data: when a failed run records a
`destination-repair-proposals` artifact, `relay://runs/{runId}/repair-proposals` reads it through
the protocol schema — review-only screen candidates with confidence, rationale, and method, or an
explicit zero-proposal result with reason `grounding-unavailable`. The
`relay_verify_this_change` prompt (available from the `proof` profile) walks an agent through the
full loop: establish impact, select affected Tests, run them once, read the proof report and repair
proposals on failure, and return a structured verdict with share links for reviewers.

## Surface and safety model

- Resources expose bounded, sanitized project, App Map, Flow, Run, Authoring Session, Target, and
  observation state under scoped `relay://` URIs. They do not provide arbitrary filesystem reads.
- Outcome tools call the typed `@relay/workflows` façade; advanced tools are generated from the
  canonical operation registry. Both invoke Relay through `@relay/client` and retain actor identity,
  lease, revision, confirmation, and idempotency rules.
- `relay_target_screenshot_capture` returns the current Target screenshot as native MCP `image/png`
  content plus safe metadata. It never exposes Relay host paths.
- Curated advanced prompts guide topology exploration, failed-path repair, and recording review.
  Every prompt requires the configured project and the relevant canonical resource IDs.
- `relay_export_evidence` returns a content-addressed TracePack for one persisted Run. Offline
  analysis verifies every digest, reports incomplete evidence, and never claims that a future target
  transition will pass.
- Observation is not mutation permission. Side-effecting and destructive operations require explicit
  user approval; confirmation-protected tools additionally require the literal `confirm: true` field.
- MCP request cancellation is forwarded to the Relay client. A cancelled request does not grant
  permission to retry, take over a lease, or overwrite a newer revision.
- Failed operations return a sanitized structured error with a stable code, HTTP status when known,
  a bounded recovery action, and the current revision when Relay supplies one. Arbitrary response
  bodies, credentials, and host paths are never forwarded.

The bridge is intentionally only a transport adapter. Run the Relay HTTP server separately; the
MCP process remains a scoped adapter, not the source of truth. The package build and clean-host
installation check can be run from this workspace with `pnpm build` and `pnpm test:clean-host`.
