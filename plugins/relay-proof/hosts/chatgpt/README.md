# ChatGPT-compatible MCP hosts

ChatGPT-compatible hosts must expose the Relay MCP server through the host's
supported MCP transport. The Relay package currently speaks MCP v2 over stdio;
use the host's reviewed local-stdio bridge when available, or publish that
bridge as a private authenticated MCP endpoint when the host accepts only
remote servers.

The server command and environment are the same as Codex and Claude:

```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["--yes", "@relay/mcp@0.1.0"],
      "env": {
        "RELAY_MCP_PROFILE": "proof"
      }
    }
  }
}
```

Configure `RELAY_URL`, `RELAY_ORGANIZATION_ID`, `RELAY_PROJECT_ID`,
`RELAY_ACTOR_ID`, and (when required) `RELAY_AUTH_TOKEN` in the bridge's
process environment. Never paste a token into the JSON or a ChatGPT prompt.
Before the first Proof, run `relay-mcp doctor --profile proof --json` in the
same environment and require `ok: true`. A host that cannot run stdio locally
must not pretend it can; expose the reviewed bridge and keep its endpoint
authenticated and project-scoped.

The ChatGPT host does not get a custom schema or a second Proof workflow. The
same canonical MCP tools, resources, confirmation rules, and human approval
boundary apply everywhere.
