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

function positionals(argv: readonly string[]): string[] {
  const values = new Set(["--after"]);
  const args: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("-") || token === "-") {
      args.push(token);
      continue;
    }
    const name = token.split("=")[0]!;
    if (values.has(name) && !token.includes("=")) index += 1;
  }
  return args;
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token.startsWith(prefix)) return token.slice(prefix.length);
    if (token === name) return argv[index + 1];
  }
  return undefined;
}

function writeJson(streams: OutputStreams, value: unknown): void {
  streams.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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
  const json = argv.includes("--json");
  const args = positionals(argv).slice(1);
  const action = args[0] ?? "path";
  const path = controlDatabasePath(env);

  if (action === "help" || argv.includes("-h") || argv.includes("--help")) {
    streams.stdout.write(dbHelp());
    return ExitCode.success;
  }
  if (action === "path") {
    if (json) writeJson(streams, { path });
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
      if (json) writeJson(streams, rows);
      else streams.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return ExitCode.success;
    } finally {
      db.close();
    }
  }
  if (action === "events") {
    const after = Number(flagValue(argv, "--after") ?? "0");
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
      if (json) writeJson(streams, rows);
      else streams.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return ExitCode.success;
    } finally {
      db.close();
    }
  }
  throw new UsageError("Expected: relay db path | query <sql> | events | shell");
}
