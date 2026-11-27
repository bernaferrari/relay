/**
 * The model key people paste into Settings. It lives in the local state
 * directory (owner-only, like saved sign-in secrets) and is never returned by
 * any API. Stored keys are self-describing so Relay can use direct providers
 * as well as OpenRouter; legacy bare keys are read as OpenRouter keys.
 */
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { findWorkspaceRoot } from "../workspace/workspace-root.js";
import type { RelayModelProvider } from "./model-provider.js";

export interface SavedModelKey {
  version: 1;
  provider: RelayModelProvider;
  key: string;
  baseURL?: string;
}

const PROVIDERS = new Set<RelayModelProvider>([
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "openai-compatible",
]);

function stateDirectory(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

export function modelKeyPath(): string {
  return join(stateDirectory(), "secrets", "model-key.json");
}

export function legacyOpenRouterKeyPath(): string {
  return join(stateDirectory(), "secrets", "openrouter.key");
}

function validProvider(value: unknown): value is RelayModelProvider {
  return typeof value === "string" && PROVIDERS.has(value as RelayModelProvider);
}

/** Accepts provider-style keys; rejects whitespace and absurd lengths. */
export function validModelKey(key: string): boolean {
  return /^[A-Za-z0-9_\-.:]{20,512}$/u.test(key);
}

export function parseSavedModelKey(contents: string): SavedModelKey | undefined {
  const trimmed = contents.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Partial<SavedModelKey>;
    if (
      parsed.version === 1 &&
      validProvider(parsed.provider) &&
      typeof parsed.key === "string" &&
      validModelKey(parsed.key.trim()) &&
      (parsed.baseURL === undefined || typeof parsed.baseURL === "string")
    ) {
      return {
        version: 1,
        provider: parsed.provider,
        key: parsed.key.trim(),
        ...(typeof parsed.baseURL === "string" && parsed.baseURL.trim()
          ? { baseURL: parsed.baseURL.trim() }
          : {}),
      };
    }
  } catch {
    // Legacy files were a bare OpenRouter key rather than JSON.
  }
  return validModelKey(trimmed) ? { version: 1, provider: "openrouter", key: trimmed } : undefined;
}

/** Read the saved key synchronously for construction-time policy decisions. */
export function readSavedModelKey(): SavedModelKey | undefined {
  try {
    const parsed = parseSavedModelKey(readFileSync(modelKeyPath(), "utf8"));
    if (parsed) return parsed;
  } catch {
    // Missing or unreadable new-format files fall through to legacy storage.
  }
  try {
    return parseSavedModelKey(readFileSync(legacyOpenRouterKeyPath(), "utf8"));
  } catch {
    return undefined;
  }
}

async function migrateLegacyKey(): Promise<SavedModelKey | undefined> {
  try {
    const legacy = parseSavedModelKey(await readFile(legacyOpenRouterKeyPath(), "utf8"));
    if (!legacy) return undefined;
    await writeSavedModelKey(legacy);
    await rm(legacyOpenRouterKeyPath(), { force: true });
    return legacy;
  } catch {
    return undefined;
  }
}

/** Call once at startup. The environment is never mutated. */
export async function loadSavedModelKey(): Promise<boolean> {
  try {
    const current = parseSavedModelKey(await readFile(modelKeyPath(), "utf8"));
    if (current) return true;
  } catch {
    // Try migration below.
  }
  return (await migrateLegacyKey()) !== undefined;
}

async function writeSavedModelKey(saved: SavedModelKey): Promise<void> {
  const path = modelKeyPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function environmentConfiguration():
  | { configured: true; source: "environment"; provider: RelayModelProvider }
  | { configured: false; source: "none" } {
  const candidates: Array<[RelayModelProvider, readonly string[]]> = [
    ["anthropic", ["ANTHROPIC_API_KEY"]],
    ["openai", ["OPENAI_API_KEY"]],
    ["google", ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]],
    ["openrouter", ["OPENROUTER_API_KEY"]],
  ];
  for (const [provider, names] of candidates) {
    if (names.some((name) => process.env[name]?.trim())) {
      return { configured: true, source: "environment", provider };
    }
  }
  if (process.env.RELAY_MODEL_BASE_URL?.trim()) {
    return { configured: true, source: "environment", provider: "openai-compatible" };
  }
  return { configured: false, source: "none" };
}

export interface SaveModelKeyOptions {
  provider?: RelayModelProvider;
  baseURL?: string;
}

/** Save (or with "", remove) the key and make it visible to resolution now. */
export async function saveModelKey(
  key: string,
  options: SaveModelKeyOptions = {},
): Promise<{ configured: boolean; source: string; provider?: RelayModelProvider }> {
  const trimmed = key.trim();
  if (!trimmed) {
    await rm(modelKeyPath(), { force: true });
    await rm(legacyOpenRouterKeyPath(), { force: true });
    return environmentConfiguration();
  }
  if (!validModelKey(trimmed)) throw new Error("That does not look like a model provider key.");
  const provider = options.provider ?? "openrouter";
  if (!PROVIDERS.has(provider)) throw new Error(`Unsupported model provider: ${provider}`);
  const baseURL = options.baseURL?.trim();
  await writeSavedModelKey({
    version: 1,
    provider,
    key: trimmed,
    ...(baseURL ? { baseURL } : {}),
  });
  await rm(legacyOpenRouterKeyPath(), { force: true });
  return { configured: true, source: "settings", provider };
}
