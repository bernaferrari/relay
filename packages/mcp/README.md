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

## Surface and safety model

- Resources expose bounded, sanitized project, Journey, Collection, Run, Authoring Session, Target,
  and observation state under scoped `relay://` URIs. They do not provide arbitrary filesystem reads.
- Tools are generated from Relay's canonical operation registry and invoke Relay through
  `@relay/client`. Mutations keep the configured agent actor identity and Relay's lease, revision, and
  idempotency rules.
- `relay_target_screenshot_capture` returns the current Target screenshot as native MCP `image/png`
  content plus safe metadata. It never exposes Relay host paths.
- Curated prompts guide safe app mapping, failed-connection repair, and Take review. Every prompt
  requires the configured project and the relevant Target, Journey, session, connection, or Take IDs.
- Observation is not mutation permission. Side-effecting and destructive operations require explicit
  user approval; confirmation-protected tools additionally require the literal `confirm: true` field.
- MCP request cancellation is forwarded to the Relay client. A cancelled request does not grant
  permission to retry, take over a lease, or overwrite a newer revision.

There is intentionally no MCP HTTP transport in this package. Run the Relay HTTP server separately;
the MCP process is a scoped stdio adapter, not the source of truth.
