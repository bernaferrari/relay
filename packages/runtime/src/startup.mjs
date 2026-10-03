import { spawn } from "node:child_process";
import { open, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve, dirname, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { hostname } from "node:os";
import { createHash } from "node:crypto";
import net from "node:net";
import { withEnsureServerBootstrapLock } from "../../../scripts/ensure-server-bootstrap.mjs";

export async function waitForRuntimeBootstrap(
  options,
  {
    bootstrap = withEnsureServerBootstrapLock,
    now = Date.now,
    delay = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {},
) {
  const deadline = now() + 35_000;
  for (;;) {
    try {
      return await bootstrap(options);
    } catch (error) {
      // Retry only a refused lock acquisition: no launch or device input occurred.
      if (error.code !== "RELAY_SERVER_BOOTSTRAP_LOCKED" || now() >= deadline) throw error;
      await delay(100);
    }
  }
}

function leaseOwner(stateDirectory) {
  let database;
  try {
    database = new DatabaseSync(resolve(stateDirectory, "relay-server-lease.sqlite"), {
      readOnly: true,
    });
    const row = database
      .prepare("SELECT document FROM relay_server_state_leases WHERE slot = ?")
      .get("relay-server");
    return row ? JSON.parse(row.document) : undefined;
  } catch (error) {
    if (error.code === "ERR_SQLITE_ERROR" && !database) return undefined;
    throw error;
  } finally {
    database?.close();
  }
}

async function health(url, token) {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(1_000),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

async function assertUnoccupiedPort(port) {
  if (!port) return;
  const listener = net.createServer();
  await new Promise((done, reject) => {
    listener.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied by an unavailable or unknown listener. Choose another port; no process was stopped.`,
        ),
      ),
    );
    listener.listen(port, "127.0.0.1", () => listener.close(done));
  });
}

export function assertCompatibleRuntime({ observed, owner, workspaceRoot, version, descriptor }) {
  const workspaceMatches =
    observed?.runsDir === resolve(workspaceRoot, "runs") ||
    (observed?.runsDir === "runs" &&
      descriptor?.workspaceRoot === workspaceRoot &&
      descriptor?.pid === owner?.pid);
  if (
    observed?.ok !== true ||
    observed.product !== "relay" ||
    observed.version !== version ||
    owner?.schemaVersion !== 1 ||
    owner.host !== hostname() ||
    owner.pid !== observed.pid ||
    !workspaceMatches ||
    observed.access?.organizationId !== "local" ||
    observed.access?.projectId !== "default"
  ) {
    throw new Error(
      "The listener is not a compatible Relay owner for this workspace. Choose another port or attach to its explicit workspace; no process was stopped.",
    );
  }
}

/** Attach or launch the same canonical service. No listener is ever killed. */
export async function ensureRelayRuntime({
  workspaceRoot,
  stateDirectory,
  port = 8787,
  token = process.env.RELAY_AUTH_TOKEN,
} = {}) {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Relay runtime requires Node.js 24 or newer.");
  if (!workspaceRoot || !isAbsolute(workspaceRoot))
    throw new Error("Choose an absolute workspace directory before starting Relay.");
  const artifactRoot = dirname(fileURLToPath(import.meta.url));
  const packageRoot = await realpath(resolve(artifactRoot, ".."));
  const outsidePackage = (path) => {
    const rel = relative(packageRoot, path);
    return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  };
  const requireExternalState = () => {
    if (!outsidePackage(workspaceRoot) || !outsidePackage(stateDirectory)) {
      throw new Error("Mutable workspace data must live outside the installed Relay package.");
    }
  };
  stateDirectory = resolve(stateDirectory ?? resolve(workspaceRoot, ".relay"));
  requireExternalState();
  await mkdir(workspaceRoot, { recursive: true });
  workspaceRoot = await realpath(workspaceRoot);
  requireExternalState();
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Port must be an integer from 0 to 65535.");
  await mkdir(stateDirectory, { recursive: true });
  stateDirectory = await realpath(stateDirectory);
  requireExternalState();
  const manifest = JSON.parse(await readFile(resolve(artifactRoot, "manifest.json"), "utf8"));
  const serverPath = resolve(artifactRoot, "server.js");
  const serverBytes = await readFile(serverPath);
  if (createHash("sha256").update(serverBytes).digest("hex") !== manifest.serverSha256) {
    throw new Error(
      "Installed Relay service differs from its release manifest. Reinstall the artifact.",
    );
  }
  return waitForRuntimeBootstrap({
    path: resolve(stateDirectory, "ensure-server-bootstrap.sqlite"),
    operation: async () => {
      let descriptor;
      try {
        descriptor = JSON.parse(await readFile(resolve(stateDirectory, "runtime.json"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const url = descriptor?.url ?? `http://127.0.0.1:${port}`;
      const endpoint = new URL(url);
      if (
        endpoint.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.pathname !== "/"
      ) {
        throw new Error(
          "The saved runtime endpoint is not a local Relay URL. Inspect runtime.json; no credentials were sent.",
        );
      }
      if (
        descriptor &&
        (descriptor.workspaceRoot !== workspaceRoot || descriptor.stateDirectory !== stateDirectory)
      ) {
        throw new Error(
          "The saved runtime descriptor belongs to another workspace or state directory. No process was stopped.",
        );
      }
      const owner = leaseOwner(stateDirectory);
      const observed = await health(url, token);
      if (observed) {
        assertCompatibleRuntime({
          observed,
          owner,
          workspaceRoot,
          version: manifest.version,
          descriptor,
        });
        return { disposition: "attached", url, pid: observed.pid, workspaceRoot, stateDirectory };
      }
      if (owner) {
        if (owner.host !== hostname())
          throw new Error(
            "This state directory belongs to a Relay service on another host. Use its explicit endpoint; no lease was rewritten.",
          );
        try {
          process.kill(owner.pid, 0);
          throw new Error(
            "This Relay state directory has a live owner but its endpoint is unavailable. Inspect its logs; no second service was launched.",
          );
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
          // Only the canonical server may reclaim a dead lease; this helper never rewrites it.
        }
      }
      await assertUnoccupiedPort(port);
      const logPath = resolve(stateDirectory, "runtime.log");
      const log = await open(logPath, "a", 0o600);
      const child = spawn(process.execPath, [serverPath], {
        cwd: workspaceRoot,
        detached: true,
        stdio: ["ignore", log.fd, log.fd, "ipc"],
        env: {
          ...process.env,
          RELAY_WORKSPACE_ROOT: workspaceRoot,
          RELAY_STATE_DIR: stateDirectory,
          RELAY_RUNS_DIR: resolve(workspaceRoot, "runs"),
          RELAY_TESTS_DIR: resolve(workspaceRoot, "tests"),
          RELAY_RECIPES_DIR: resolve(workspaceRoot, "recipes"),
          AGENT_DEVICE_STATE_DIR:
            process.env.AGENT_DEVICE_STATE_DIR ?? resolve(stateDirectory, "agent-device"),
          RELAY_PORT: String(port),
          RELAY_AUTH_TOKEN: token ?? "",
        },
      });
      await log.close();
      try {
        const identity = await new Promise((done, reject) => {
          const timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Relay startup is still unresolved. Inspect ${logPath}; no process was killed or retried.`,
                ),
              ),
            30_000,
          );
          child.once("error", reject);
          child.once("exit", (code) => {
            clearTimeout(timeout);
            reject(
              new Error(
                `Relay service exited (${code}). Inspect ${logPath}; the existing listener and data were preserved.`,
              ),
            );
          });
          child.once("message", (message) => {
            clearTimeout(timeout);
            if (message.type !== "relay-runtime-ready")
              return reject(new Error("Unexpected runtime startup acknowledgement."));
            done(message.identity);
          });
        });
        const ready = await health(identity.url, token);
        assertCompatibleRuntime({
          observed: ready,
          owner: leaseOwner(stateDirectory),
          workspaceRoot,
          version: manifest.version,
          descriptor: identity,
        });
        return { disposition: "started", ...identity, logPath };
      } finally {
        if (child.connected) child.disconnect();
        child.unref();
      }
    },
  });
}
