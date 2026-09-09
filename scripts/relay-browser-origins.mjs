import { readFileSync, writeFileSync } from "node:fs";

const schemaVersion = 1;

function parseOrigins(raw) {
  const values = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of values) {
    if (value === "*" || value !== new URL(value).origin) {
      throw new Error(`Relay browser origin must be an exact HTTP(S) origin: ${value}`);
    }
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Relay browser origin must be HTTP(S): ${value}`);
    }
  }
  return [...new Set(values)];
}

export function relayBrowserOriginsFile(stateDir) {
  return `${stateDir}/server-browser-origins.json`;
}

/**
 * Preserve the exact allowlist supplied by a trusted launcher so a later
 * repository-local ensure-server restart can retain it. The file contains
 * origins only; it never persists the broader process environment.
 */
export function persistConfiguredBrowserOrigins(stateDir, configured) {
  const origins = parseOrigins(configured);
  writeFileSync(
    relayBrowserOriginsFile(stateDir),
    `${JSON.stringify({ schemaVersion, origins }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return origins;
}

export function readPersistedBrowserOrigins(stateDir) {
  try {
    const payload = JSON.parse(readFileSync(relayBrowserOriginsFile(stateDir), "utf8"));
    if (payload?.schemaVersion !== schemaVersion || !Array.isArray(payload.origins)) return [];
    return parseOrigins(payload.origins.join(","));
  } catch {
    return [];
  }
}

export function resolveBrowserOrigins(stateDir, configured) {
  if (configured !== undefined) return persistConfiguredBrowserOrigins(stateDir, configured);
  return readPersistedBrowserOrigins(stateDir);
}
