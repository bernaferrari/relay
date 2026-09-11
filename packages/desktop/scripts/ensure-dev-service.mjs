import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readPersistedBrowserOrigins } from "../../../scripts/relay-browser-origins.mjs";

export async function rendererCanReachService(url, origin) {
  try {
    const response = await fetch(`${url}/health`, {
      headers: { Origin: origin },
      signal: AbortSignal.timeout(1500),
    });
    return (
      response.ok &&
      response.headers.get("access-control-allow-origin") === origin &&
      (await response.json()).product === "relay"
    );
  } catch {
    return false;
  }
}

export async function ensureDevService(root, url, origin) {
  if (await rendererCanReachService(url, origin)) return;
  if (url !== "http://127.0.0.1:8787") {
    throw new Error(`Relay service at ${url} must allow renderer origin ${origin}.`);
  }
  const workspace = resolve(root, "../..");
  const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.json())
    .catch(() => null);
  if (health?.activeJob || health?.activeJobs?.length) {
    throw new Error(
      "A Test is running. Finish it before restarting Relay desktop to update its connection.",
    );
  }
  const origins = [
    ...new Set([
      ...readPersistedBrowserOrigins(resolve(workspace, ".relay")),
      ...(process.env.RELAY_ALLOWED_BROWSER_ORIGINS ?? "").split(",").filter(Boolean),
      origin,
    ]),
  ];
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(workspace, "scripts/ensure-server.mjs")], {
      cwd: workspace,
      env: { ...process.env, RELAY_ALLOWED_BROWSER_ORIGINS: origins.join(",") },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? done() : reject(new Error(`Relay service startup failed (${code}).`)),
    );
  });
  if (!(await rendererCanReachService(url, origin)))
    throw new Error("Relay service started but desktop access is unavailable.");
}
