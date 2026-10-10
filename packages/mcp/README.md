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
connect to Relay or require credentials. Every MCP profile also has
`relay_get_guide` (and the `relay://guides` resources). The CLI's `relay guide`
reads the same catalog, so instructions match the shipped code.

## Tool profiles

Relay MCP has three profiles. Each one contains the one before it.

| Profile        | Tools | Use it to                                                              |
| -------------- | ----- | ---------------------------------------------------------------------- |
| `qa` (default) | 13    | Write a Test from a sentence, run it, read the verdict, check a change |
| `device`       | 36    | Everything in `qa`, plus drive a device or browser and record Tests    |
| `full`         | ~290  | Everything in `device`, plus every raw Relay operation as a tool       |

Pick one with `--profile <name>` or `RELAY_MCP_PROFILE`. Destructive tools
(cancel, delete, remove, discard, revoke) carry the MCP `destructiveHint`
annotation and read-only tools carry `readOnlyHint`, so a host can ask before
side effects.

**`qa`** — the agent loop and what it needs to find its way:

| Tool                    | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `relay_create_test`     | Save a Test from a description (`goal`) or a test file (`yaml`) |
| `relay_run_test`        | Run a Test and wait for its verdict                             |
| `relay_get_verdict`     | Read a Run's verdict later                                      |
| `relay_inspect_failure` | Explain a failed Run: failing step, evidence, suggested fixes   |
| `relay_check_change`    | Run the relevant ready Tests after a code change                |
| `relay_list_apps`       | List Apps                                                       |
| `relay_list_tests`      | List one App's Tests and whether each is ready                  |
| `relay_list_runs`       | List recent Runs                                                |
| `relay_list_devices`    | List ready phones, emulators and browsers with their `targetId` |
| `relay_get_test`        | Read a Test as its test file                                    |
| `relay_get_guide`       | Read the bundled how-to guides                                  |
| `relay_health`          | Check that Relay and its prerequisites are ready                |
| `relay_panel`           | Read-only Tests and results view (MCP Apps hosts)               |

**`device`** adds live control and recording:

| Tool                                                                     | What it does                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| `relay_screenshot`, `relay_observe_target`                               | See the screen (image, or image plus controls)    |
| `relay_tap`, `relay_type`, `relay_swipe`, `relay_press_key`              | Send one input (`key`: back, home, enter, …)      |
| `relay_preview`                                                          | Show where a tap would land without doing it      |
| `relay_launch_app`, `relay_recover`                                      | Open an app; reconnect a device that stopped      |
| `relay_record_test`, `relay_record_action`, `relay_add_checkpoint`       | Record a Test step by step                        |
| `relay_stop_recording`, `relay_edit_recording`, `relay_replay_recording` | Review a recording                                |
| `relay_approve_recording`                                                | Save the recording as a Test                      |
| `relay_repeat_test`, `relay_continue_repeat`                             | Run one Test over several values                  |
| `relay_inspect_workflow`, `relay_cancel_run`                             | Read or stop a recording, repeat or Run           |
| `relay_explore_goal`                                                     | Let a model drive toward a goal, in few steps     |
| `relay_propose_repair`, `relay_export_evidence`                          | Suggest a fix for review; export a Run's evidence |

Device tools take `targetId` from `relay_list_devices`, or `laneId` for a saved
browser sign-in. They take control of a free device automatically and say who
holds a busy one.

**`full`** adds `relay_replay_lab`, the Proof tools (`relay_prove_change`,
`relay_inspect_proof`) and one `relay_<operation>` tool per Relay operation,
named after its operation id (for example `relay_target_screenshot_capture`).
Raw tools take the operation's fields directly, and wrapped or alternate input
envelopes are rejected. `full` leaves out the raw operations a named tool
already covers, and it is the only profile that exposes `lease.takeover`.

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

Configure `--profile qa` to write, run and check Tests, or `--profile device`
to also drive devices and record (the Relay plugin uses `device`). Configure the
intended service or workspace, authorized project, and actor in the host
environment. Reload the MCP connection after changing its configuration.

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

## Change Proof

The executable defaults to `qa` when no profile is selected. Proof hosts launch
`--profile full`: it adds `relay_prove_change`, `relay_inspect_proof` and the raw
`proof.*` lifecycle tools for explicit plan review, recovery, publication, and
selective reruns. A human approves a Verification Plan in the app or CLI.

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay-mcp",
      "args": ["--profile", "full"],
      "env": { "RELAY_MCP_PROFILE": "full" }
    }
  }
}
```

The `full` doctor check verifies every canonical Proof tool is present:

```bash
relay-mcp doctor --profile full --json
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

## Run an existing Test

With `qa`, call `relay_list_apps` and `relay_list_tests` to find the saved Test,
`relay_list_devices` to pick a ready target, then `relay_run_test`:

```json
{ "appMapId": "checkout", "testId": "signed-in-home", "targetId": "<returned-target-id>" }
```

It waits for the verdict. With `wait:false` it returns the `runId` at once; read
the verdict later with `relay_get_verdict` instead of starting the Test again.
Execution completion and human screenshot acceptance remain separate outcomes.

## Agent quickstart: record, run, and review

Configure `--profile device` and your intended service or workspace. Check
`relay-mcp doctor --profile device --json` with those same connection options.
For a contributor service, `pnpm ensure:serve` starts Relay; it replaces the
port listener, so use it before starting a recording or Run.

1. Call `relay_health`, then `relay_list_apps` and `relay_list_tests` to find
   the intended saved Test before creating one.
2. Call `relay_list_devices` and keep the selected `targetId`. An existing Test
   can run directly with `relay_run_test`.
3. When coverage is missing, call `relay_get_guide {topic:"record"}`, look at
   the starting screen with `relay_observe_target`, and use `relay_record_test`.
   Each recording step carries the workflow id and expected version returned
   by the previous step.
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
`relay_prove_this_change` prompt (available from the `full` profile) walks an agent through the
full loop: establish impact, select affected Tests, obtain human approval for the frozen plan, call
the server-owned `relay_proof_run` once, inspect its durable Proof result and repair proposals on
failure, and return a structured verdict with share links for reviewers. Lower-level Test/job tools
remain an explicit legacy/manual `record-runs` recovery path, not the normal Proof execution loop.

## Surface and safety model

- Resources expose bounded, sanitized project, App Map, Flow, Run, Authoring Session, Target, and
  observation state under scoped `relay://` URIs. They do not provide arbitrary filesystem reads.
- Named tools call the typed `@relay/workflows` façade or one operation; raw `full` tools are
  generated from the canonical operation registry. Both invoke Relay through `@relay/client` and retain actor identity,
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

## The qa loop

`relay-mcp` (or `--profile qa`) is describe-first:

- `relay_create_test {goal, url | app}` writes Action/Check steps from a sentence, saves the
  Test, and returns the exact `relay_run_test` call. `{yaml}` applies a test file as written.
- `relay_run_test` waits for the verdict by default (`wait:false` returns at once;
  `timeoutSeconds` bounds the wait, which returns `status: "running"` when it runs out).
  The agent response never includes the compiled plan.
- `relay_get_verdict {runId}` reads passed/failed/blocked/cancelled, a reason, and each failed
  step's expected vs. saw and screenshot. `relay_inspect_failure` includes the failing step.
- `relay_check_change {app, areas?, testIds?}` runs the App's relevant ready Tests and returns
  their verdicts — a quick signal, not a merge decision; gated merge checks use Change Proof.

Steps written from words need a model key; recording (`device` profile) makes a step exact and
model-free. Every profile registers these tools; `full` hides the raw operations they wrap.
Run `relay-mcp doctor --profile qa` against the same configured service first.
The connector requires a compatible Relay runtime and target prerequisites;
the optional local startup described above can attach or launch the runtime.

### Read-only Tests and results panel

The default `qa` profile includes `relay_panel` to inspect existing Apps, saved Tests,
recent Runs and one retained PNG per request. It calls canonical read operations;
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
