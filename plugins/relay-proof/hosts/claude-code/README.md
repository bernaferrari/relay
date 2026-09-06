# Claude Code

Copy [`.mcp.json`](./.mcp.json) into the Claude Code project configuration (or
merge its `mcpServers.relay` entry into the existing file). It launches the
same host-neutral `@relay/mcp` package used by Codex:

```bash
npm install --global @relay/mcp@0.1.0 # after the public release
# Before publication, from this repository:
# npm pack --silent ./packages/mcp && npm install --global ./relay-mcp-0.1.0.tgz
export RELAY_URL=http://127.0.0.1:8787
export RELAY_ORGANIZATION_ID=local
export RELAY_PROJECT_ID=default
export RELAY_ACTOR_ID=agent:claude-code
export RELAY_AUTH_TOKEN=…
relay-mcp doctor --profile proof
```

Claude should use the Relay Proof instructions in
[`../../skills/relay-proof/SKILL.md`](../../skills/relay-proof/SKILL.md). The
MCP package owns tool names, schemas, role requirements, confirmation, and
evidence semantics; this file only selects the `proof` profile.
