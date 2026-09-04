#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function relayBrowserOrigin(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid Relay app port: ${port}`);
  }
  return `http://127.0.0.1:${port}`;
}

export function relayBrowserOrigins(port) {
  relayBrowserOrigin(port);
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

export function allowedBrowserOriginsWith(origin, configured = "") {
  return [
    ...new Set([...configured.split(","), origin].map((value) => value.trim()).filter(Boolean)),
  ].join(",");
}

/** Keep the preferred Relay URL trusted when an already-running renderer
 * makes the launcher select the next port. This lets a V2 browser and a
 * second development renderer coexist without the newer process silently
 * breaking the first one's service access. */
export function relayDevelopmentOrigins(preferredPort, selectedPort) {
  return [
    ...new Set([...relayBrowserOrigins(preferredPort), ...relayBrowserOrigins(selectedPort)]),
  ];
}

export function relayAppPackage(args = []) {
  const unknown = args.filter((argument) => argument !== "--v2");
  if (unknown.length) throw new Error(`Unknown Relay app option: ${unknown[0]}`);
  return "@relay/app-v2";
}

async function portAvailable(port) {
  return await new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function chooseAppPort(preferred) {
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await portAvailable(port)) return port;
  }
  throw new Error(`No available Relay app port between ${preferred} and ${preferred + 19}`);
}

async function main() {
  const appPackage = relayAppPackage(process.argv.slice(2));
  const configured = Number(process.env.RELAY_APP_PORT || 3000);
  if (!Number.isSafeInteger(configured) || configured < 1 || configured > 65_535) {
    throw new Error("RELAY_APP_PORT must be an integer between 1 and 65535");
  }
  const port = await chooseAppPort(configured);
  const [browserUrl] = relayBrowserOrigins(port);
  const env = {
    ...process.env,
    RELAY_ALLOWED_BROWSER_ORIGINS: relayDevelopmentOrigins(configured, port).reduce(
      (configuredOrigins, allowedOrigin) =>
        allowedBrowserOriginsWith(allowedOrigin, configuredOrigins),
      process.env.RELAY_ALLOWED_BROWSER_ORIGINS ?? "",
    ),
  };

  process.stdout.write(`Starting Relay for the browser at ${browserUrl}\n`);
  const service = spawnSync(process.execPath, [join(root, "scripts/ensure-server.mjs")], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (service.status !== 0) {
    throw new Error("Relay service could not start; see the diagnostic above");
  }

  const app = spawn(
    "pnpm",
    [
      "--filter",
      appPackage,
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => app.kill(signal));
  }
  const exitCode = await new Promise((resolve, reject) => {
    app.once("error", reject);
    app.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
