# ChatGPT-compatible MCP hosts

ChatGPT-compatible hosts must expose the Relay MCP server through the host's
supported MCP transport. `@relay/mcp` uses the MCP server SDK over stdio and ships a
reviewed `relay-mcp-bridge` that carries that exact process over an authenticated
HTTP endpoint when the host accepts only remote servers. The bridge is a
transport adapter: it does not fork Proof schemas, tool names, or approval
semantics.

## Remote MCP (recommended when the host accepts only a URL)

On the machine that can reach Relay, install the package and run the bridge
behind an HTTPS reverse proxy:

```bash
npm install --global @relay/mcp@0.1.0 # after the public release
# Before publication, install the local artifact from the repository:
npm pack --silent ./packages/mcp
npm install --global ./relay-mcp-0.1.0.tgz
export RELAY_URL=https://relay.example
export RELAY_ORGANIZATION_ID=acme
export RELAY_PROJECT_ID=checkout
export RELAY_ACTOR_ID=agent:chatgpt
export RELAY_MCP_PROFILE=device
export RELAY_AUTH_TOKEN=…                  # Relay credential, process environment only
export RELAY_MCP_BRIDGE_AUTH_TOKEN=…       # separate bridge credential, host secret/reference
relay-mcp-bridge --host 127.0.0.1 --port 8788 --auth-env RELAY_MCP_BRIDGE_AUTH_TOKEN
```

Expose `https://your-host.example/mcp` through a TLS reverse proxy. In the
ChatGPT-compatible host, add that URL as the MCP `server_url` and provide the
bridge credential through the host's authorization/secret mechanism. Require
approval for side-effecting tools. Never place either credential in this file,
the host JSON, command arguments, or a prompt. The bridge refuses an
unauthenticated public bind and keeps Relay's token in the child process
environment only.

## Local stdio

Use the same package directly when the host launches local MCP commands:

```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["--yes", "--package", "@relay/mcp@0.1.0", "relay-mcp", "--profile", "device"],
      "env": {
        "RELAY_MCP_PROFILE": "device"
      }
    }
  }
}
```

Configure `RELAY_URL`, `RELAY_ORGANIZATION_ID`, `RELAY_PROJECT_ID`,
`RELAY_ACTOR_ID`, and (when required) `RELAY_AUTH_TOKEN` in the process
environment. Before the first task, run `relay-mcp doctor --profile device
--json` in that same environment and require `ok: true`. A host that cannot
run stdio locally must use the reviewed bridge and keep its endpoint
authenticated and project-scoped.

The ChatGPT host does not get a custom schema or a second Proof workflow. The
same canonical MCP tools, resources, confirmation rules, and human approval
boundary apply everywhere.

Every profile includes the read-only `relay_panel` tool. A host that
advertises `io.modelcontextprotocol/ui` with `text/html;profile=mcp-app` gets
the bundled Tests and results view. Other hosts get its state as text.
The panel has no live device controls or visual acceptance buttons. Installed
artifact tests verify negotiated HTML and the tools-only fallback. Codex and
ChatGPT rendering still needs verification in each host.

### Qualify the panel

1. Configure the installed connector for the intended Relay project. Run
   `relay-mcp doctor --profile device --json` in the host environment.
2. Call `relay_panel` in the host and confirm the view opens on the first
   result. Select an App and a retained Run, navigate screenshots, and refresh.
3. Confirm that the panel respects project scope and retains the last view
   with an actionable error when Relay disconnects. Check keyboard navigation,
   theme changes, and fullscreen behavior.
