# Relay Proof plugin

Relay is the runtime proof layer between an AI coding agent and the merge
button. This plugin gives Codex a project-scoped MCP connection with the
curated `proof` profile. The same host-neutral `relay-mcp` package can be used
by Claude Code and any ChatGPT-compatible MCP host.

## Install

The plugin is intentionally independent of the Relay monorepo. Install the
published MCP package (or the exact release approved by your organization)
after it is available on npm:

```bash
npm install --global @relay/mcp@0.1.0
```

Before publication, install the same clean-host artifact directly from a checkout:

```bash
npm pack --silent ./packages/mcp
npm install --global ./relay-mcp-0.1.0.tgz
```

The bundled Codex and Claude descriptors invoke the installed `relay-mcp` binary, so a clean host
does not need pnpm, a workspace checkout, or a second agent protocol.

Before opening an agent session, configure the host environment. Keep the
token in the environment; never put it in a plugin file, prompt, argument, or
proof payload:

```bash
export RELAY_URL=http://127.0.0.1:8787
export RELAY_ORGANIZATION_ID=local
export RELAY_PROJECT_ID=default
export RELAY_ACTOR_ID=agent:codex
export RELAY_AUTH_TOKEN=…             # omit for an explicitly trusted local server
```

Run the doctor before asking an agent to control a target:

```bash
relay-mcp doctor --profile proof
relay-mcp doctor --profile proof --json
```

The doctor checks Relay reachability, project scope, actor identity, the
selected profile's role requirements, human-only plan approval, and every
canonical Proof operation exposed by the server manifest. It never prints the
token.

## Agent contract

Use the `relay_verify_this_change` prompt or the `relay_proof_*` tools for the
merge loop. Start with `relay_workspace_change_inspect`: the active Relay
workspace is the authority for the current change. Restored tabs, browser
history, and manually typed repository or SHA values do not select a Proof.
Only an actual base ambiguity should require a choice.

Agents may inspect impact, assemble a plan, call the server-owned
`relay_proof_run` exactly once after approval, inspect its durable execution
summary and evidence, and prepare a bounded repair packet. A human must
approve the frozen Verification Plan. Never infer a green result from an
accepted request, transport response, or a stale tab. Every Proof remains
bound to its exact head, build digests, target profiles, evidence, and policy
version. Legacy/manual Runs may be imported with `record-runs` only when
explicitly needed for recovery; they are not a replacement for `proof.run`.

After a repair, create a new Proof and rerun only affected journeys. The old
Proof remains immutable history. `needs-review`, `insufficient-evidence`, and
`outcome-unknown` are honest terminal states, not passes.

## Host descriptors

- [Codex](./.codex-plugin/plugin.json) loads the MCP server and the Relay Proof
  skill automatically.
- [Claude Code](./hosts/claude-code/README.md) uses the same `.mcp.json`
  contract and executable.
- [ChatGPT-compatible hosts](./hosts/chatgpt/README.md) use the same MCP
  server through their supported remote/stdio bridge; this package does not
  fork or reinterpret Relay operations.

The source of truth remains Relay's canonical protocol registry. Host files
only configure transport, identity references, and guidance. A remote-only
ChatGPT-compatible host should use the package's reviewed
`relay-mcp-bridge` over HTTPS; it forwards the same authenticated stdio
session and never stores or redefines credentials, tools, or Proof schemas.
