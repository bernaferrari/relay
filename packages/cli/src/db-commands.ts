import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ExitCode, UsageError } from "./errors.js";
import type { OutputStreams } from "./output.js";

const CONTROL_DB_NAME = "control.sqlite";

export function dbHelp(): string {
  return `Relay db commands

Inspect the local control plane SQLite file (leases, maps, durable events).
This does not go through the HTTP server. Presence and cursors are not stored here.

Usage:
  relay db path
  relay db query <sql>
  relay db events [--after <seq>]
  relay db shell

Examples:
  relay db path
  relay db query "SELECT id, status, device_serial FROM leases"
  relay db events --json --after 0
  relay db shell
`;
}

function findWorkspaceRoot(start = process.cwd()): string {
  let directory = start;
  for (;;) {
    if (
      existsSync(join(directory, "pnpm-workspace.yaml")) ||
      existsSync(join(directory, "pnpm-lock.yaml"))
    ) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return start;
    directory = parent;
  }
}

function controlStateRoot(env: Record<string, string | undefined>): string {
  return env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function controlDatabasePath(env: Record<string, string | undefined>): string {
  return join(controlStateRoot(env), CONTROL_DB_NAME);
}

const dbValueFlags = ["--after"] as const;
const dbSwitchFlags = ["--json", "--ndjson", "--quiet", "-h", "--help"] as const;

/** Strict token parse: unknown flags are a UsageError, never a silent positional. */
function parseDbArgs(argv: readonly string[]): {
  positionals: string[];
  values: Map<string, string>;
  switches: Set<string>;
} {
  const valueFlags = new Set<string>(dbValueFlags);
  const switchFlags = new Set<string>(dbSwitchFlags);
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

function writeJson(streams: OutputStreams, value: unknown, compact = false): void {
  streams.stdout.write(`${JSON.stringify(value, null, compact ? 0 : 2)}\n`);
}

function openExisting(path: string): DatabaseSync {
  if (!existsSync(path)) {
    throw new UsageError(
      `No control database at ${path}. Write control state or start the server first.`,
    );
  }
  return new DatabaseSync(path, { readOnly: true });
}

async function runShell(path: string): Promise<number> {
  return await new Promise((resolve) => {
    const child = spawn("sqlite3", [path], { stdio: "inherit" });
    child.on("error", () => resolve(ExitCode.server));
    child.on("close", (code) => resolve(code === 0 ? ExitCode.success : ExitCode.server));
  });
}

export async function runDbCommand(
  argv: readonly string[],
  streams: OutputStreams,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const { positionals, values, switches } = parseDbArgs(argv);
  const machine = switches.has("--json") || switches.has("--ndjson");
  const quiet = switches.has("--quiet");
  const args = positionals.slice(1);
  const action = args[0] ?? "path";
  const path = controlDatabasePath(env);

  if (action === "help" || switches.has("-h") || switches.has("--help")) {
    streams.stdout.write(dbHelp());
    return ExitCode.success;
  }
  if (action === "path") {
    if (quiet) return ExitCode.success;
    if (machine) writeJson(streams, { path });
    else streams.stdout.write(`${path}\n`);
    return ExitCode.success;
  }
  if (action === "shell") {
    if (!existsSync(path)) {
      throw new UsageError(
        `No control database at ${path}. Write control state or start the server first.`,
      );
    }
    return runShell(path);
  }
  if (action === "query") {
    const sql = args.slice(1).join(" ").trim();
    if (!sql) throw new UsageError("Expected: relay db query <sql>");
    const db = openExisting(path);
    try {
      const rows = db.prepare(sql).all();
      if (!quiet) writeJson(streams, rows, machine ? true : false);
      return ExitCode.success;
    } finally {
      db.close();
    }
  }
  if (action === "events") {
    const after = Number(values.get("--after") ?? "0");
    if (!Number.isInteger(after) || after < 0)
      throw new UsageError("--after must be a non-negative integer");
    const db = openExisting(path);
    try {
      const rows = db
        .prepare(
          `SELECT seq, id, at, project_id, type, resource, resource_id
           FROM control_events WHERE seq > ? ORDER BY seq LIMIT 100`,
        )
        .all(after);
      if (!quiet) writeJson(streams, rows, machine ? true : false);
      return ExitCode.success;
    } finally {
      db.close();
    }
  }
  throw new UsageError("Expected: relay db path | query <sql> | events | shell");
}
