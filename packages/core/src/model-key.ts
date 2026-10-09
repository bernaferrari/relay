/**
 * The model key people paste into Settings. It lives in the local state
 * directory (owner-only file, like saved sign-in secrets), is loaded into the
 * server's environment at startup, and is never returned by any API.
 * An OPENROUTER_API_KEY set in the environment always wins.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { findWorkspaceRoot } from "./workspace-root.js";

const ENV = "OPENROUTER_API_KEY";
let environmentKey: string | undefined;
let savedKeyLoaded = false;

function keyPath(): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  return join(state, "secrets", "openrouter.key");
}

/** Accepts OpenRouter-style keys; rejects whitespace and absurd lengths. */
export function validModelKey(key: string): boolean {
  return /^[A-Za-z0-9_\-.:]{20,512}$/u.test(key);
}

/** Call once at startup. Leaves an environment-provided key untouched. */
export async function loadSavedModelKey(): Promise<boolean> {
  environmentKey ??= process.env[ENV]?.trim() || undefined;
  if (environmentKey) return false;
  try {
    const key = (await readFile(keyPath(), "utf8")).trim();
    if (!validModelKey(key)) return false;
    process.env[ENV] = key;
    savedKeyLoaded = true;
    return true;
  } catch {
    return false;
  }
}

/** Save (or with "", remove) the key and apply it to this process now. */
export async function saveModelKey(key: string): Promise<{ configured: boolean; source: string }> {
  environmentKey ??= savedKeyLoaded ? undefined : process.env[ENV]?.trim() || undefined;
  const trimmed = key.trim();
  const path = keyPath();
  if (!trimmed) {
    await rm(path, { force: true });
    if (!environmentKey) delete process.env[ENV];
    savedKeyLoaded = false;
    return environmentKey
      ? { configured: true, source: "environment" }
      : { configured: false, source: "none" };
  }
  if (!validModelKey(trimmed)) throw new Error("That does not look like an OpenRouter key.");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${trimmed}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, 0o600);
  // A key typed in Settings is the person's current choice for this server.
  process.env[ENV] = trimmed;
  savedKeyLoaded = true;
  return { configured: true, source: "settings" };
}
