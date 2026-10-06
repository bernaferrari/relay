# Relay MCP

`@relay/mcp` gives MCP clients a project-scoped view of Relay through the same server operations used
by the app and CLI. The distribution contains a bundled host-neutral executable, so an agent
host can install it with npm without pnpm or a Relay workspace. Its default MCP v2 transport is
stdio; the reviewed `relay-mcp-bridge` command adapts that same process to Streamable HTTP for
hosts that accept only a remote MCP URL. Stdout is reserved for MCP protocol messages and
diagnostics go to stderr.

## Read task guidance offline

```bash
relay-mcp --help
relay-mcp guide
relay-mcp guide record
relay-mcp guide waits --json
```

The installed artifact includes guidance for setup, recording, running, target
selection, waits, debugging, review, maps, and agents. These commands do not
connect to Relay or require credentials. Every MCP profile also exposes
`relay://guides` and the topic URIs it lists. The CLI's `relay guide` reads the
same catalog, so instructions match the shipped code.

## Find a saved Test with QA tools

The Relay plugin configures `--profile qa` for recording and saved Test work.
Use the same option in a manually configured MCP connection. After
`relay_health`, call `relay_panel` to choose an App, then call it with that
`appMapId` to list its Tests and recent Runs. The tool also returns text when
the host cannot display MCP Apps.

For detailed steps, read `relay://app-maps/<appMapId>/tests/<testId>` using the
returned IDs. Choose the intended target through `relay_connect_target`, then
call `relay_run_test` with those exact IDs. Inspect its returned workflow with
`relay_inspect_workflow`; queued work is not a completed Run. For recording,
read `relay://guides/record` before sending actions.

Use `relay://app-maps` and `relay://app-maps/<appMapId>/tests` for resource-only
discovery; follow returned next-page URIs when a collection is paginated.

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
relay-mcp doctor --profile qa --json
```

The plugin descriptor invokes the installed `relay-mcp` binary. A clean host does not need pnpm or
the Relay Workspace after the package is installed.

### Optional local runtime startup

Install the matching `@relay/runtime` local candidate beside this connector,
then configure `--workspace /absolute/path/my-project` (or
`RELAY_WORKSPACE_ROOT`) to attach or launch its canonical service. Mutable
accounts, Tests and evidence belong outside plugin caches. `--runtime-port`
(or `RELAY_RUNTIME_PORT`) selects a free local port; startup never kills an
unknown listener or replaces a live workspace owner. Explicit `--server` or
`RELAY_URL` retains attachment to that endpoint. Local startup uses
`local/default` scope and preserves the configured actor and credentials.

Offline `guide` and read-only `doctor` never launch a runtime. The runtime
candidate's [installation and browser demo](../runtime/README.md) is verified
without repository sources; physical device support requires qualification.

For your first recording, saved Test, or review task, configure `--profile qa`.
This matches the plugin and exposes the outcome tools used in the task guides.
Configure the intended service or workspace, authorized project, and actor in
the host environment. Reload the MCP connection after changing its configuration.

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay-mcp",
      "args": ["--profile", "qa"]
    }
  }
}
```

Run the setup check with the same profile and connection options as the host.
It reports `NOT READY` when the service is unavailable or the scope or role is wrong:

```bash
relay-mcp doctor --profile qa --json
```

It checks server reachability, organization/project scope, the configured agent identity, the
selected profile's role requirements, and the canonical tools present in the server operation
manifest for that profile. The report never prints `RELAY_AUTH_TOKEN`.

## Specialist profiles

Existing integrations retain the executable's `operator` default when no profile
is selected. New recording and Test integrations should explicitly select `qa`.
Choose another profile with `--profile <name>` or `RELAY_MCP_PROFILE` when the
task requires its specialist tools.
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
export RELAY_MCP_PROFILE=qa
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
      "args": ["--yes", "--package", "@relay/mcp@0.1.0", "relay-mcp", "--profile", "qa"],
      "env": { "RELAY_MCP_PROFILE": "qa" }
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

Use `qa` for ordinary recording, saved Tests, and evidence review. The executable
still defaults to `operator` for existing integrations. Configure the required
profile once when setting up the host; discover its tools before the task.
`full` is trusted orchestration only and is the only profile that exposes
`lease.takeover`.

| Profile    | Intended use                                                                              |
| ---------- | ----------------------------------------------------------------------------------------- |
| `qa`       | Recommended first use: record, run, repeat, inspect, review, and export existing evidence |
| `operator` | Executable compatibility default: ~19 verbs + `relay_advanced`; no `lease.takeover`       |
| `outcome`  | Test workflow: connect, observe, record, replay, run, repeat, inspect, export             |
| `control`  | Advanced direct target observation, input, recovery, and lease management                 |
| `map`      | Discovery and observation proposals without full authoring edits                          |
| `observe`  | Read-only project, device, App Map, proposal, run, and evidence inspection                |
| `author`   | Default App Map editing, device recording, and proposal creation                          |
| `test`     | Graph Test creation, review, compilation, one-pass runs, and evidence                     |
| `run`      | Test/Combine execution, jobs, and run evidence                                            |
| `execute`  | Alias of `run` for execution-focused agents                                               |
| `locale`   | Language Variables, profiles, Combine campaigns, and analysis                             |
| `review`   | Proposal/take repair, replay, approval, and run-baseline review                           |
| `admin`    | Workspace policy, projects, targets, schedules, matrices, and retention                   |
| `proof`    | Prove one change with the outcome tool plus explicit proof.* lifecycle/recovery controls  |
| `full`     | Every canonical Relay operation; trusted orchestration only; includes `lease.takeover`    |

Outcome tools accept job-level intent and resolve the sole Test workspace, Device, current revision,
and available control internally. Advanced profile tools advertise and take canonical operation
fields directly. For example, capture a screenshot with
`{"serial":"emulator-5554"}`. Wrapped or alternate input envelopes are rejected. Known operation
contracts expose specific required fields, types, and enums; intentionally generic Relay operations
remain extensible objects and are still validated by the canonical protocol parser before invocation.

## Run an existing Test

With the recommended `qa` profile, use `relay_panel` to choose an App and its
saved Test. Call `relay_connect_target` to choose the intended ready target,
then call `relay_run_test` with the returned exact IDs:

```json
{ "appMapId": "checkout", "testId": "signed-in-home", "targetId": "<returned-target-id>" }
```

Inspect the returned workflow through `relay_inspect_workflow`. Keep that
workflow ID through disconnections instead of starting the Test again. A queued
workflow is not a completed Run; execution completion and human screenshot
acceptance remain separate outcomes.

### Operator compatibility

Existing `operator` integrations call `relay_run` with the saved Test identity:

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
conflicting aliases are rejected. `relay_screenshot` accepts either a serial or a Lane (browser captures go through the Lane's exact account context); `relay_recover` accepts that same Lane or a serial;
a Lane-aware `relay_preview` returns pixels without committing the interaction.

For a long Plan, set `wait:false` on `relay_plan_run`. It returns the batch and job IDs immediately.
Inspect those jobs with `relay_wait`, then use `relay_findings` after completion. `findings`,
`triage`, and `export` cannot be combined with `wait:false`. The `export` option is a boolean,
not a destination path. The existing blocking behavior remains the default.

## Agent quickstart: record, run, and review

Configure `--profile qa` and your intended service or workspace. Check
`relay-mcp doctor --profile qa --json` with those same connection options. For
a contributor service, `pnpm ensure:serve` starts Relay; it replaces the port
listener, so use it before starting a recording or Run.

1. Call `relay_health`, then `relay_panel` to choose an App. Call the panel
   with its `appMapId` to find the intended saved Test before creating one.
2. Call `relay_connect_target` and keep the selected target identity. An
   existing Test can run directly with `relay_run_test`.
3. When coverage is missing, read `relay://guides/record`, observe the starting
   screen with `relay_observe_target`, and use `relay_record_test`. Each
   recording mutation carries the continuation reference and expected version
   returned by the previous step.
4. Use `relay_inspect_workflow` until completion or a concrete blocker, then
   `relay_export_evidence` to share the retained Run.

For native recording, limit discovery with
`{"targetKind":"device","phase":"android"}` or `"ios"`, then pass the returned
`targetId` to observation, recording, and replay. Set `originApplication` on
`relay_record_test` to the exact native package or bundle the saved Test must
reopen. Add a goal outcome check through `relay_record_action` using the
canonical `interaction: {kind:"steps",steps:[...]}` contract with `expect` or
`wait-for` and a bounded timeout. `relay_add_checkpoint` retains evidence;
the authored condition is the executable check. `relay_edit_recording` also
accepts `insert-before` to add a check to a reviewed recording; replay that
edited revision before saving it.

Repeat explicitly selected data values with `relay_repeat_test`; inspect one
pilot before confirming `relay_continue_repeat`. The CLI language variant is
documented in [Repeat a Test across languages](../../docs/LANGUAGE_SWEEP_LOOP.md).

For existing operator authoring integrations, `relay_save` accepts the canonical
Test document and current `expectedRevision`. Lower-level recording operations
remain available through `relay_advanced`. The `outcome` profile retains its
workflow interface for hosts already using it.

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
`proof` and `outcome` remain explicit profiles; `operator` retains the executable
default for compatibility.
Run `relay-mcp doctor --profile qa` against the same configured service first.
The connector requires a compatible Relay runtime and target prerequisites;
the optional local startup described above can attach or launch the runtime.

### Read-only Tests and results panel

The QA preset adds `relay_panel` to inspect existing Apps, saved Tests, recent
Runs and one retained PNG per request. It calls canonical read operations;
it cannot start Runs, capture a live device or accept visual evidence.
Screenshot bytes are retained artifact data, bounded and checked against their
recorded SHA-256 before inclusion in result metadata.

Execution completion, canonical check outcome and screenshot acceptance are
shown separately. A completed execution with pending captures says awaiting
review; its frozen revision, repair history and missing or blocked obligations
remain visible. Catalog reads are separate from Run metadata and frame reads:
`view: "run"` loads at most 40 capture entries, and `view: "frame"` loads one
entry and its selected PNG with a 2 MB display limit. Next/Previous preserve
the Run and configuration, reject stale responses, and explain unavailable
images without substituting another capture. Catalog and manifest truncation
are explicit; an older Run or another App can be selected by exact id in chat.

On initialization, hosts that advertise the MCP Apps HTML MIME type receive
the `ui://relay/review` resource and opener metadata. Other hosts receive the
same bounded state as text with no view metadata or UI resource. The bundled
HTML has no external dependencies or network access requirements.

MCP server SDK 2.1.0 and MCP Apps SDK 2.0.3 are pinned together. OpenAI
Extensions 0.1.0 currently peers with the v1 SDK, so its documented thread
entrypoint/fullscreen metadata is supplied directly without importing an
incompatible runtime. Capability and copied-artifact tests pass; actual
Codex/ChatGPT rendering remains unverified. See the plugin's
[host qualification guide](../../plugins/relay-proof/hosts/panel.md).
