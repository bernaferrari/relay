# Relay MCP

`@relay/mcp` gives MCP clients a project-scoped view of Relay through the same server operations used
by the app and CLI. The published package contains a bundled host-neutral executable, so an agent
host can install it with npm without pnpm or a Relay workspace. Its default MCP v2 transport is
stdio; the reviewed `relay-mcp-bridge` command adapts that same process to Streamable HTTP for
hosts that accept only a remote MCP URL. Stdout is reserved for MCP protocol messages and
diagnostics go to stderr.

## Read task guidance offline

```bash
relay-mcp guide
relay-mcp guide record
relay-mcp guide waits --json
```

The installed artifact includes guidance for setup, recording, running, target
selection, waits, debugging, review, maps, and agents. These commands do not
connect to Relay or require credentials. Every MCP profile also exposes
`relay://guides` and the topic URIs it lists. The CLI's `relay guide` reads the
same catalog, so instructions match the shipped code.

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
relay-mcp doctor
```

The plugin descriptor invokes the installed `relay-mcp` binary. A clean host does not need pnpm or
the Relay Workspace after the package is installed.

The default configuration needs no profile flag: the local defaults use the loopback Relay service,
the local project, actor `agent:cursor`, and the `operator` profile (~19 hand-named verbs plus
`relay_advanced`). That default is a complete ordinary task surface — resolve a target, observe,
operate within scope, run saved coverage, inspect progress, save a Test, and export evidence — so
an agent never switches profiles mid-task. `lease.takeover` is not on that profile. Configure
your MCP client with the installed command below and reload its connection after changing it.

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay-mcp"
    }
  }
}
```

The fail-closed setup check works the same way without a profile. It intentionally reports
`NOT READY` when the Relay service is unavailable or the scope or role is wrong:

```bash
relay-mcp doctor --json
```

It checks server reachability, organization/project scope, the configured agent identity, the
selected profile's role requirements, and the canonical tools present in the server operation
manifest for that profile. The report never prints `RELAY_AUTH_TOKEN`.

## Specialist profiles

Trusted orchestrators can opt into a narrower or lower-level profile with `--profile <name>` or
`RELAY_MCP_PROFILE`. Specialist access is additive, never a prerequisite for ordinary testing.
Proof hosts launch `--profile proof`: it retains the ordinary `relay_prove_change` outcome and
adds the raw `proof.*` lifecycle tools for explicit plan review, recovery, publication, and
selective reruns. A human approves a Verification Plan in the app or CLI.

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

The specialist doctor check verifies every canonical Proof tool is present for that profile:

```bash
relay-mcp doctor --profile proof --json
```

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
      "command": "npx",
      "args": ["--yes", "--package", "@relay/mcp@0.1.0", "relay-mcp", "--profile", "proof"],
      "env": { "RELAY_MCP_PROFILE": "proof" }
    }
  }
}
```

The `npx --package` form is a one-command clean-host setup; it does not require a Relay checkout
or a globally installed binary. Hosts that manage npm packages centrally may install
`@relay/mcp@0.1.0` once and invoke `relay-mcp` directly instead.

For a ChatGPT-compatible remote MCP client, select the bridge URL and require approval for
side-effecting tools in the host. Do not recreate the Relay tool list in the host configuration;
the bridge exposes exactly the profile selected by `RELAY_MCP_PROFILE`.

## Tool profiles

Relay defaults to the `operator` profile (~19 hand-named verbs plus `relay_advanced`; no
`lease.takeover`). Agents do not need to select a profile for ordinary device and Plan work.
Trusted orchestrators can opt into a lower-level profile with `--profile <name>` or
`RELAY_MCP_PROFILE`. `full` is trusted orchestration only and is the only profile that exposes
`lease.takeover`.

| Profile    | Intended use                                                                             |
| ---------- | ---------------------------------------------------------------------------------------- |
| `operator` | Default (Cursor / this repo): ~19 verbs + `relay_advanced`; no `lease.takeover`          |
| `outcome`  | Test workflow: connect, observe, record, replay, run, repeat, inspect, export            |
| `control`  | Advanced direct target observation, input, recovery, and lease management                |
| `map`      | Discovery and observation proposals without full authoring edits                         |
| `observe`  | Read-only project, device, App Map, proposal, run, and evidence inspection               |
| `author`   | Default App Map editing, device recording, and proposal creation                         |
| `test`     | Graph Test creation, review, compilation, one-pass runs, and evidence                    |
| `run`      | Test/Combine execution, jobs, and run evidence                                           |
| `execute`  | Alias of `run` for execution-focused agents                                              |
| `locale`   | Language Variables, profiles, Combine campaigns, and analysis                            |
| `review`   | Proposal/take repair, replay, approval, and run-baseline review                          |
| `admin`    | Workspace policy, projects, targets, schedules, matrices, and retention                  |
| `proof`    | Prove one change with the outcome tool plus explicit proof.* lifecycle/recovery controls |
| `full`     | Every canonical Relay operation; trusted orchestration only; includes `lease.takeover`   |

Outcome tools accept job-level intent and resolve the sole Test workspace, Device, current revision,
and available control internally. Advanced profile tools advertise and take canonical operation
fields directly. For example, capture a screenshot with
`{"serial":"emulator-5554"}`. Wrapped or alternate input envelopes are rejected. Known operation
contracts expose specific required fields, types, and enums; intentionally generic Relay operations
remain extensible objects and are still validated by the canonical protocol parser before invocation.

## Run an existing Test

With the default operator profile, call `relay_run` directly with the saved Test identity:

```json
{ "appMapId": "checkout", "testId": "signed-in-home", "lane": "qa-member" }
```

There is no manual tap or exploration prerequisite. Use `relay_wait` with the returned job ID;
`{"jobId":"job-1","wait":false}` reads current progress once without waiting. Keep that job ID
through disconnections instead of starting the Test again. Execution completion is separate from
human screenshot acceptance.

For manual observation and control, `relay_snapshot`, `relay_preview`, `relay_tap`, `relay_type`,
and `relay_swipe` accept either `serial` or `lane`. Use the same Lane as the Test to preserve the
browser/account context. Do not combine a serial with a Lane. `laneId` is an equivalent alias;
conflicting aliases are rejected. `relay_screenshot` accepts either a serial or a Lane (browser captures go through the Lane's exact account context); `relay_recover` still requires a serial;
a Lane-aware `relay_preview` returns pixels without committing the interaction.

For a long Plan, set `wait:false` on `relay_plan_run`. It returns the batch and job IDs immediately.
Inspect those jobs with `relay_wait`, then use `relay_findings` after completion. `findings`,
`triage`, and `export` cannot be combined with `wait:false`. The `export` option is a boolean,
not a destination path. The existing blocking behavior remains the default.

## Agent quickstart: verify one flow across languages

Run the Relay service first (`pnpm ensure:serve`) and check `relay-mcp doctor --json`. With the
default operator profile:

1. Use `relay_lanes` or `relay_devices` to choose the exact saved account context or device.
2. Use `relay_snapshot` and `relay_preview` to inspect the current app before a manual action.
3. Use `relay_run` for one saved Test, or `relay_plan_run` for one case of a saved Plan. Pass
   `executionMode:"all"` only when every selected case is requested.
4. Use `relay_wait` with the returned job ID, then `relay_evidence`, `relay_findings`, or
   `relay_export` to inspect and share the result.

For an authored Test, `relay_save` accepts the canonical Test document and its current
`expectedRevision`. The operator profile exposes lower-level recording operations through
`relay_advanced`; its input is the named canonical operation plus that operation's schema. The
`outcome` specialist profile offers separate recording workflow verbs when a host deliberately
uses that interface. A recording workflow mutation carries the continuation reference and
expected version returned by the previous step. The language variant is documented in
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
`relay_prove_this_change` prompt (available from the `proof` profile) walks an agent through the
full loop: establish impact, select affected Tests, obtain human approval for the frozen plan, call
the server-owned `relay_proof_run` once, inspect its durable Proof result and repair proposals on
failure, and return a structured verdict with share links for reviewers. Lower-level Test/job tools
remain an explicit legacy/manual `record-runs` recovery path, not the normal Proof execution loop.

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
  a bounded recovery action, and the current revision when Relay supplies one. Recovery commands
  are emitted only when their canonical operation is registered by the selected profile; otherwise
  `recoveryGuidance` names the hidden operation and gives a profile/operator handoff. Arbitrary
  response bodies, credentials, and host paths are never forwarded.

The bridge is intentionally only a transport adapter. Run the Relay HTTP server separately; the
MCP process remains a scoped adapter, not the source of truth. The package build and clean-host
installation check can be run from this workspace with `pnpm build` and `pnpm test:clean-host`.

## Ordinary QA preset

`relay-mcp --profile qa` selects the existing model-free recording, run, repeat,
inspection and export outcomes, plus health, preview and recovery operators.
App/Test resources remain discoverable. It excludes assisted goals, raw admin
operations and Change Proof. The `relay-proof` plugin now selects this preset;
`proof`, `operator` and `outcome` remain explicit compatibility profiles.
Run `relay-mcp doctor --profile qa` against the same configured service first.
The connector still requires an existing Relay runtime and target prerequisites.
