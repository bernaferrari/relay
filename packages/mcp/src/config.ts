import type { ServerConnection } from "@relay/protocol";
import { isAbsolute } from "node:path";
import { defaultRelayMcpProfile, resolveRelayMcpProfile, type RelayMcpProfile } from "./tools.js";

export type CredentialSource = { type: "none" } | { type: "env"; name: string };

export type McpConfig = {
  connection: ServerConnection;
  credentialSource: CredentialSource;
  timeoutMs: number;
  profile: RelayMcpProfile;
  runtime?: { workspaceRoot: string; port?: number };
};

type Environment = Record<string, string | undefined>;

const defaults = {
  server: "http://127.0.0.1:8787",
  organization: "local",
  project: "default",
  credentialSource: "env:RELAY_AUTH_TOKEN",
  timeout: "180000",
  profile: defaultRelayMcpProfile,
} as const;

const valueFlags = new Set([
  "--server",
  "--organization",
  "--project",
  "--credential-source",
  "--actor",
  "--timeout",
  "--profile",
  "--workspace",
  "--runtime-port",
]);

function parseArguments(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    const equals = token.indexOf("=");
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (!valueFlags.has(name)) throw new TypeError(`Unknown option: ${name}`);
    const value = equals >= 0 ? token.slice(equals + 1) : argv[++index];
    if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value`);
    values.set(name, value);
  }
  return values;
}

function choose(cli: string | undefined, env: string | undefined, fallback: string): string {
  return cli ?? (env?.trim() || fallback);
}

function parseCredentialSource(value: string): CredentialSource {
  if (value === "none") return { type: "none" };
  if (value.startsWith("env:") && value.length > 4) {
    return { type: "env", name: value.slice(4) };
  }
  throw new TypeError("--credential-source must be 'none' or 'env:NAME'");
}

export function parseMcpConfig(
  argv: readonly string[],
  env: Environment = process.env,
  _processId = process.pid,
): McpConfig {
  const values = parseArguments(argv);
  const explicitCredentialSource =
    values.get("--credential-source") ?? env.RELAY_CREDENTIAL_SOURCE?.trim();
  const credentialSource = parseCredentialSource(
    explicitCredentialSource || defaults.credentialSource,
  );
  const credential = credentialSource.type === "env" ? env[credentialSource.name] : undefined;
  if (credentialSource.type === "env" && explicitCredentialSource && !credential) {
    throw new TypeError(`Credential environment variable ${credentialSource.name} is not set`);
  }

  const timeoutRaw = choose(values.get("--timeout"), env.RELAY_TIMEOUT_MS, defaults.timeout);
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("--timeout must be a positive integer in milliseconds");
  }

  const actorId = choose(values.get("--actor"), env.RELAY_ACTOR_ID, "agent:cursor");
  const profile = resolveRelayMcpProfile(
    choose(values.get("--profile"), env.RELAY_MCP_PROFILE, defaults.profile),
  );
  const connection: ServerConnection = {
    url: choose(values.get("--server"), env.RELAY_URL, defaults.server),
    organizationId: choose(
      values.get("--organization"),
      env.RELAY_ORGANIZATION_ID,
      defaults.organization,
    ),
    projectId: choose(values.get("--project"), env.RELAY_PROJECT_ID, defaults.project),
    actorId,
    actorKind: "agent",
    auth: credential ? { type: "bearer", token: credential } : { type: "none" },
  };

  const workspaceRoot = values.get("--workspace") ?? env.RELAY_WORKSPACE_ROOT?.trim();
  if (workspaceRoot && !isAbsolute(workspaceRoot)) {
    throw new TypeError(
      "--workspace must be an absolute directory outside the plugin installation",
    );
  }
  // Explicit endpoints retain attach-only semantics, including remote and scoped services.
  const runtimePortRaw = values.get("--runtime-port") ?? env.RELAY_RUNTIME_PORT?.trim();
  const runtimePort = runtimePortRaw ? Number(runtimePortRaw) : undefined;
  if (
    runtimePort !== undefined &&
    (!Number.isInteger(runtimePort) || runtimePort < 0 || runtimePort > 65535)
  ) {
    throw new TypeError("--runtime-port must be an integer from 0 to 65535");
  }
  const runtime =
    workspaceRoot && !values.has("--server") && !env.RELAY_URL?.trim()
      ? { workspaceRoot, ...(runtimePort === undefined ? {} : { port: runtimePort }) }
      : undefined;
  return { connection, credentialSource, timeoutMs, profile, ...(runtime ? { runtime } : {}) };
}

export function redactedMcpConfig(config: McpConfig): Record<string, unknown> {
  return {
    server: config.connection.url,
    organization: config.connection.organizationId,
    project: config.connection.projectId,
    actor: config.connection.actorId,
    actorKind: config.connection.actorKind,
    credentialSource:
      config.credentialSource.type === "none" ? "none" : `env:${config.credentialSource.name}`,
    credential: config.connection.auth.type === "none" ? "none" : "configured",
    timeoutMs: config.timeoutMs,
    profile: config.profile,
    ...(config.runtime ? { workspace: config.runtime.workspaceRoot } : {}),
  };
}
