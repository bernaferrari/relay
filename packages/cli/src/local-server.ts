import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export type LocalServerResult = { status: "already-running" | "started"; pid?: number };

type Health = { ok?: unknown; product?: unknown; pid?: unknown };

export type LocalServerDependencies = {
  readHealth(url: URL): Promise<Health | undefined>;
  runEnsure(input: {
    executable: string;
    arguments: readonly string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }): Promise<{ stdout: string; stderr: string }>;
};

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const ensureScript = fileURLToPath(new URL("../../../scripts/ensure-server.mjs", import.meta.url));
const bootstrapTimeoutMs = 30_000;

function loopback(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
  );
}

function relayHealth(value: Health | undefined): value is Health & { ok: true; product: "relay" } {
  return value?.ok === true && value.product === "relay";
}

async function defaultReadHealth(url: URL): Promise<Health | undefined> {
  try {
    const response = await fetch(new URL("/health", url), {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as Health) : undefined;
  } catch {
    return undefined;
  }
}

function defaultRunEnsure(
  input: Parameters<LocalServerDependencies["runEnsure"]>[0],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      input.executable,
      [...input.arguments],
      {
        cwd: input.cwd,
        env: input.env,
        timeout: input.timeoutMs,
        maxBuffer: 256 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout: String(stdout), stderr: String(stderr) }));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

const defaults: LocalServerDependencies = {
  readHealth: defaultReadHealth,
  runEnsure: defaultRunEnsure,
};

function boundedDiagnostic(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const candidate = error as { message?: unknown; stderr?: unknown };
  const detail =
    typeof candidate.stderr === "string" && candidate.stderr.trim()
      ? candidate.stderr.trim()
      : typeof candidate.message === "string"
        ? candidate.message
        : String(error);
  return detail.replace(/[\r\n\t]+/gu, " ").slice(0, 1_000);
}

/** Ensure only the implicit local Relay endpoint. Explicit URLs are filtered
 * by CLI configuration; this loopback guard makes direct use fail closed too.
 * The existing bootstrap is invoked with execFile, never through a shell. */
export async function ensureLocalRelayServer(
  serverUrl: string,
  dependencies: LocalServerDependencies = defaults,
): Promise<LocalServerResult> {
  const url = new URL(serverUrl);
  if (!loopback(url)) {
    throw new TypeError(
      "Automatic Relay startup is allowed only for the implicit loopback server.",
    );
  }
  let ensureOutput: { stdout: string; stderr: string };
  try {
    ensureOutput = await dependencies.runEnsure({
      executable: process.execPath,
      arguments: [ensureScript, "--reuse"],
      cwd: workspaceRoot,
      env: { ...process.env, RELAY_PORT: url.port || "80" },
      timeoutMs: bootstrapTimeoutMs,
    });
  } catch (error) {
    throw new Error(
      `Relay could not start its local server: ${boundedDiagnostic(error)}. Run 'node scripts/ensure-server.mjs --reuse' for full diagnostics.`,
      { cause: error },
    );
  }

  const started = await dependencies.readHealth(url);
  if (!relayHealth(started)) {
    throw new Error(
      "Relay started a local server process but /health did not identify Relay. Check .relay/server.log or run 'node scripts/ensure-server.mjs --reuse'.",
    );
  }
  const reportedAlreadyRunning = ensureOutput.stdout
    .split("\n")
    .some((line) => line.includes('"status":"already-running"'));
  return {
    status: reportedAlreadyRunning ? "already-running" : "started",
    ...(Number.isSafeInteger(started.pid) ? { pid: Number(started.pid) } : {}),
  };
}
