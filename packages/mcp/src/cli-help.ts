import { defaultRelayMcpProfile, relayMcpProfiles } from "./tools.js";

export function relayMcpHelp(): string {
  return `Relay MCP connector

Usage:
  relay-mcp [options]                  Serve MCP tools over stdio
  relay-mcp doctor [options]           Check connection and permissions without launching
  relay-mcp guide [topic] [--json]     Read bundled task guidance offline
  relay-mcp --help                     Show this help without connecting or launching

Connection options:
  --server <url>                      Attach to an existing Relay service
  --workspace <absolute-directory>    Attach or launch using optional @relay/runtime
  --runtime-port <port>               Port for workspace startup (default 8787)
  --organization <id>                 Authorized organization (default local)
  --project <id>                      Authorized project (default default)
  --actor <agent:name>                 Agent identity (default agent:cursor)
  --profile <name>                    ${relayMcpProfiles.join(", ")} (default ${defaultRelayMcpProfile})
  --credential-source <none|env:NAME>  Credentials from environment (default env:RELAY_AUTH_TOKEN)
  --timeout <milliseconds>            Request deadline (default 180000)

First agent task:
  Configure --profile qa and your explicit server or workspace.
  Run relay-mcp doctor --profile qa with the same connection options.
  In your MCP host, call relay_health, then relay_list_apps and relay_list_tests.
  Call relay_get_guide for how-to guides and relay_list_devices to pick a target.
  Use --profile device to drive a device and record; full adds every raw operation.

RELAY_URL keeps attachment to an existing service; it overrides workspace startup.
RELAY_WORKSPACE_ROOT and RELAY_RUNTIME_PORT configure workspace startup.
RELAY_ORGANIZATION_ID, RELAY_PROJECT_ID, RELAY_ACTOR_ID and RELAY_MCP_PROFILE
configure the same options through the host environment. Browser engines and
native tools remain prerequisites. The connector does not install a host UI.
`;
}
