import type { ActorKind, ServerConnection } from "@relay/protocol";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { resolveCommand, resolveResourceCommand, type CommandBehavior } from "./commands.js";
import { UsageError } from "./errors.js";

export type OutputMode = "human" | "json" | "ndjson";
export type CredentialSource = { type: "none" } | { type: "env"; name: string };
export type ScreenshotOutput =
  | { kind: "default" }
  | { kind: "file"; path: string; force: boolean }
  | { kind: "binary" };

export type GlobalConfig = {
  connection: ServerConnection;
  credentialSource: CredentialSource;
  output: OutputMode;
  quiet: boolean;
  timeoutMs: number;
  wait: boolean;
};

export type ParsedCli =
  | {
      config: GlobalConfig;
      command: "help";
      helpFamily?: string;
    }
  | {
      config: GlobalConfig;
      command: "invoke";
      operationId: string;
      input: Record<string, unknown>;
      commandPath?: string;
      behavior?: CommandBehavior;
      screenshotOutput: ScreenshotOutput;
    }
  | {
      config: GlobalConfig;
      command: "resource";
      resourceId: string;
      resourcePath: string;
      commandPath: string;
    };

type Environment = Record<string, string | undefined>;

const defaults = {
  server: "http://127.0.0.1:8787",
  organization: "local",
  project: "default",
  actor: "human:local-cli",
  credentialSource: "env:RELAY_AUTH_TOKEN",
  // A single authoring operation can include device recovery, several gestures,
  // assertions, and evidence capture. Keep the CLI patient by default; callers
  // that need a tighter bound can still pass --timeout explicitly.
  timeout: "120000",
  wait: true,
} as const;

type ParsedTokens = {
  positionals: string[];
  values: Map<string, string>;
  switches: Set<string>;
};

const valueFlags = new Set([
  "--server",
  "--organization",
  "--project",
  "--credential-source",
  "--actor",
  "--timeout",
  "--input",
  "--input-file",
  "--file",
]);
const switchFlags = new Set([
  "-h",
  "--help",
  "--json",
  "--ndjson",
  "--quiet",
  "--wait",
  "--no-wait",
  "--binary",
  "--force",
]);

function tokenize(argv: readonly string[]): ParsedTokens {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (switchFlags.has(name)) {
      if (equals >= 0) throw new UsageError(`${name} does not take a value`);
      switches.add(name);
      continue;
    }
    if (!valueFlags.has(name)) throw new UsageError(`Unknown option: ${name}`);
    const value = equals >= 0 ? token.slice(equals + 1) : argv[++index];
    if (!value || value.startsWith("--")) throw new UsageError(`${name} requires a value`);
    values.set(name, value);
  }
  return { positionals, values, switches };
}

function choose(cli: string | undefined, env: string | undefined, fallback: string): string {
  return cli ?? (env?.trim() || fallback);
}

function parseCredentialSource(value: string): CredentialSource {
  if (value === "none") return { type: "none" };
  if (value.startsWith("env:") && value.length > 4) return { type: "env", name: value.slice(4) };
  throw new UsageError("--credential-source must be 'none' or 'env:NAME'");
}

function actorKind(actorId: string): ActorKind {
  if (actorId.startsWith("agent:")) return "agent";
  if (actorId.startsWith("system:")) return "system";
  return "human";
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new UsageError("RELAY_WAIT must be true, false, 1, or 0");
}

function parseInput(rawInput: string | undefined): Record<string, unknown> {
  if (rawInput === undefined) return {};
  let input: unknown;
  try {
    input = JSON.parse(rawInput) as unknown;
  } catch {
    throw new UsageError("--input must be valid JSON");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UsageError("--input must be a JSON object");
  }
  return input as Record<string, unknown>;
}

function readInput(tokens: ParsedTokens, env: Environment): Record<string, unknown> {
  const inline = tokens.values.get("--input");
  const file = tokens.values.get("--input-file");
  if (inline !== undefined && file !== undefined) {
    throw new UsageError("Use only one of --input or --input-file");
  }
  if (!file) return parseInput(inline);
  const path = isAbsolute(file) ? file : resolve(env.INIT_CWD?.trim() || process.cwd(), file);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Could not read --input-file ${file}: ${message}`);
  }
  return parseInput(contents);
}

function screenshotOutput(
  tokens: ParsedTokens,
  output: OutputMode,
  eligible: boolean,
): ScreenshotOutput {
  const file = tokens.values.get("--file");
  const binary = tokens.switches.has("--binary");
  const force = tokens.switches.has("--force");
  if (!file && !binary && !force) return { kind: "default" };
  if (!eligible) {
    throw new UsageError("--file, --binary, and --force are only valid for screenshot commands");
  }
  if (file && binary) throw new UsageError("Use only one of --file or --binary");
  if (force && !file) throw new UsageError("--force requires --file <path>");
  if (binary && output !== "human") {
    throw new UsageError("--binary cannot be combined with --json or --ndjson");
  }
  if (file) return { kind: "file", path: file, force };
  if (binary) return { kind: "binary" };
  return { kind: "default" };
}

export function parseCli(argv: readonly string[], env: Environment = process.env): ParsedCli {
  const tokens = tokenize(argv);
  if (tokens.switches.has("--json") && tokens.switches.has("--ndjson")) {
    throw new UsageError("Use only one of --json or --ndjson");
  }
  if (tokens.switches.has("--wait") && tokens.switches.has("--no-wait")) {
    throw new UsageError("Use only one of --wait or --no-wait");
  }

  const explicitCredentialSource =
    tokens.values.get("--credential-source") ?? env.RELAY_CREDENTIAL_SOURCE?.trim();
  const credentialSource = parseCredentialSource(
    explicitCredentialSource || defaults.credentialSource,
  );
  const credential = credentialSource.type === "env" ? env[credentialSource.name] : undefined;
  if (credentialSource.type === "env" && explicitCredentialSource && !credential) {
    throw new UsageError(`Credential environment variable ${credentialSource.name} is not set`);
  }
  const actor = choose(tokens.values.get("--actor"), env.RELAY_ACTOR_ID, defaults.actor);
  const timeoutRaw = choose(tokens.values.get("--timeout"), env.RELAY_TIMEOUT_MS, defaults.timeout);
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new UsageError("--timeout must be a positive integer in milliseconds");
  }
  const wait = tokens.switches.has("--wait")
    ? true
    : tokens.switches.has("--no-wait")
      ? false
      : booleanEnv(env.RELAY_WAIT, defaults.wait);
  const output: OutputMode = tokens.switches.has("--ndjson")
    ? "ndjson"
    : tokens.switches.has("--json")
      ? "json"
      : "human";

  const connection: ServerConnection = {
    url: choose(tokens.values.get("--server"), env.RELAY_URL, defaults.server),
    organizationId: choose(
      tokens.values.get("--organization"),
      env.RELAY_ORGANIZATION_ID,
      defaults.organization,
    ),
    projectId: choose(tokens.values.get("--project"), env.RELAY_PROJECT_ID, defaults.project),
    actorId: actor,
    actorKind: actorKind(actor),
    auth: credential ? { type: "bearer", token: credential } : { type: "none" },
  };

  const [group, action, operationId, ...extra] = tokens.positionals;
  const helpSwitch = tokens.switches.has("-h") || tokens.switches.has("--help");
  if (group === undefined || helpSwitch || group === "help") {
    if (group === "help" && operationId !== undefined) {
      throw new UsageError("Expected: relay help [family]");
    }
    return {
      config: {
        connection,
        credentialSource,
        output,
        quiet: tokens.switches.has("--quiet"),
        timeoutMs,
        wait,
      },
      command: "help",
      ...(group === "help"
        ? action
          ? { helpFamily: action }
          : {}
        : group
          ? { helpFamily: group }
          : {}),
    };
  }

  const rawInput = tokens.values.get("--input");
  const inputFile = tokens.values.get("--input-file");
  if (group === "operation") {
    if (action !== "invoke" || !operationId || extra.length > 0) {
      throw new UsageError("Expected: relay operation invoke <operationId> --input <json>");
    }
    if (rawInput === undefined && inputFile === undefined) {
      throw new UsageError("operation invoke requires --input <json> or --input-file <path>");
    }
    return {
      config: {
        connection,
        credentialSource,
        output,
        quiet: tokens.switches.has("--quiet"),
        timeoutMs,
        wait,
      },
      command: "invoke",
      operationId,
      input: readInput(tokens, env),
      ...(operationId === "target.screenshot.capture" ? { behavior: "screenshot" as const } : {}),
      screenshotOutput: screenshotOutput(
        tokens,
        output,
        operationId === "target.screenshot.capture",
      ),
    };
  }

  const input = readInput(tokens, env);
  const resource = resolveResourceCommand(tokens.positionals, input);
  if (resource) {
    screenshotOutput(tokens, output, false);
    return {
      config: {
        connection,
        credentialSource,
        output,
        quiet: tokens.switches.has("--quiet"),
        timeoutMs,
        wait,
      },
      command: "resource",
      resourceId: resource.resourceId,
      resourcePath: resource.resourcePath,
      commandPath: resource.commandPath,
    };
  }

  const resolved = resolveCommand(tokens.positionals, input);
  if (resolved.behavior === "event-stream" && output === "json") {
    throw new UsageError(
      `${resolved.commandPath} is a stream; use --ndjson (or human output) instead of --json`,
    );
  }
  return {
    config: {
      connection,
      credentialSource,
      output,
      quiet: tokens.switches.has("--quiet"),
      timeoutMs,
      wait,
    },
    command: "invoke",
    operationId: resolved.operationId,
    input: resolved.input,
    commandPath: resolved.commandPath,
    ...(resolved.behavior ? { behavior: resolved.behavior } : {}),
    screenshotOutput: screenshotOutput(
      tokens,
      output,
      resolved.operationId === "target.screenshot.capture",
    ),
  };
}

export function redactedConfig(config: GlobalConfig): Record<string, unknown> {
  return {
    server: config.connection.url,
    organization: config.connection.organizationId,
    project: config.connection.projectId,
    actor: config.connection.actorId,
    credentialSource:
      config.credentialSource.type === "none" ? "none" : `env:${config.credentialSource.name}`,
    credential: config.connection.auth.type === "none" ? "none" : "configured",
    output: config.output,
    quiet: config.quiet,
    timeoutMs: config.timeoutMs,
    wait: config.wait,
  };
}
