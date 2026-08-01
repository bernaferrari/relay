export const HELP = `Relay — server-first operation client

Usage:
  relay operation invoke <operationId> --input <json> [global options]
  relay help

Global options:
  --server <url>                    Relay server (env RELAY_URL)
  --organization <id>              Organization scope (env RELAY_ORGANIZATION_ID)
  --project <id>                   Project scope (env RELAY_PROJECT_ID)
  --credential-source <source>     none or env:NAME (env RELAY_CREDENTIAL_SOURCE)
  --actor <id>                     Actor identity (env RELAY_ACTOR_ID)
  --json                           One terminal JSON object
  --ndjson                         Typed records ending in a terminal result
  --quiet                          Suppress stderr diagnostics
  --timeout <ms>                   Request timeout (env RELAY_TIMEOUT_MS)
  --wait | --no-wait               Wait policy (env RELAY_WAIT)

Examples:
  relay operation invoke system.health.get --input '{}'
  relay operation invoke job.get --input '{"jobId":"job-123"}' --json

Precedence is CLI options, then environment, then defaults. Credentials are read only from the
named environment variable and are never printed. Relay does not start a server automatically.
`;
