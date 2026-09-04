#!/usr/bin/env node
/** Ensure the repository Relay server accepts the origins used by Product V2 acceptance. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { allowedBrowserOriginsWith, relayBrowserOrigins } from "./dev-app.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const API_URL = process.env.RELAY_API ?? "http://127.0.0.1:8787";
const APP_PORT = Number(process.env.RELAY_SMOKE_APP_PORT ?? 3000);

function localRelayPort(rawUrl) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Product V2 acceptance can prepare only a local Relay origin, received ${url.origin}`,
    );
  }
  const port = Number(url.port || 80);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid Relay acceptance port: ${url.port}`);
  }
  return port;
}

async function relayAcceptsOrigins(apiUrl, origins) {
  const base = apiUrl.replace(/\/$/u, "");
  try {
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_500) });
    if (!health.ok) return false;
    const document = await health.json();
    if (document.ok !== true || document.product !== "relay") return false;
    for (const origin of origins) {
      const response = await fetch(`${base}/health`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
        },
        signal: AbortSignal.timeout(1_500),
      });
      if (
        response.status !== 204 ||
        response.headers.get("access-control-allow-origin") !== origin
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function waitForRelayOrigins(apiUrl, origins, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await relayAcceptsOrigins(apiUrl, origins)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  } while (Date.now() < deadline);
  return false;
}

async function main() {
  const relayPort = localRelayPort(API_URL);
  const origins = relayBrowserOrigins(APP_PORT);
  // A Vite+/tsx postinstall or source edit can briefly rotate the watched
  // child while preserving its configured environment. Let that handoff
  // settle before asking ensure-server to replace anything.
  if (await waitForRelayOrigins(API_URL, origins, 5_000)) {
    process.stdout.write(
      `${JSON.stringify({ status: "already-compatible", port: relayPort, origins })}\n`,
    );
    return;
  }

  const allowedOrigins = origins.reduce(
    (configured, origin) => allowedBrowserOriginsWith(origin, configured),
    process.env.RELAY_ALLOWED_BROWSER_ORIGINS ?? "",
  );
  const result = spawnSync(process.execPath, [resolve(ROOT, "scripts/ensure-server.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      RELAY_PORT: String(relayPort),
      RELAY_ALLOWED_BROWSER_ORIGINS: allowedOrigins,
    },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Relay acceptance server could not be prepared; see the diagnostic above");
  }
  if (!(await waitForRelayOrigins(API_URL, origins, 5_000))) {
    throw new Error("Relay restarted but did not accept the Product V2 browser origins");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
