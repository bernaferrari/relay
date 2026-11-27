import { REDACTED, type RedactionPolicy } from "@relay/protocol";
import {
  readWorkspaceSetting,
  workspaceSettingFile,
  writeWorkspaceSetting,
} from "../workspace/workspace-settings.js";

import {
  digestValue,
  redactTextContent,
  redactUrlContent,
  redactValueForEnabledPolicy,
  redactionKeyIsSensitive,
} from "./redaction-primitives.js";

export { REDACTED } from "@relay/protocol";
export {
  digestValue,
  redactSensitiveEvidenceValue,
  redactValueForPolicy,
} from "./redaction-primitives.js";

export class RedactionPolicyLockedError extends Error {
  constructor() {
    super(`${REDACTION_ENV} controls this setting and must be changed at startup`);
    this.name = "RedactionPolicyLockedError";
  }
}

const REDACTION_ENV = "RELAY_REDACTION_MODE";
const REDACTION_FILE = "privacy.json";
const DEFAULT_POLICY: RedactionPolicy = {
  enabled: false,
  source: "default",
  locked: false,
};

let activePolicy: RedactionPolicy = DEFAULT_POLICY;

type PersistedRedactionPolicy = {
  schemaVersion: 1;
  enabled: boolean;
  updatedAt: number;
};

export function redactionPolicyFile(): string {
  return workspaceSettingFile(REDACTION_FILE);
}

function environmentPolicy(): RedactionPolicy | null {
  const raw = process.env[REDACTION_ENV]?.trim().toLowerCase();
  if (!raw) return null;
  if (["on", "true", "1", "enabled"].includes(raw)) {
    return { enabled: true, source: "environment", locked: true };
  }
  if (["off", "false", "0", "disabled"].includes(raw)) {
    return { enabled: false, source: "environment", locked: true };
  }
  throw new Error(`${REDACTION_ENV} must be on or off`);
}

export function getRedactionPolicy(): RedactionPolicy {
  return { ...activePolicy };
}

/** Load once at host startup, or again after changing workspace/environment in tests. */
export async function loadRedactionPolicy(): Promise<RedactionPolicy> {
  const fromEnvironment = environmentPolicy();
  if (fromEnvironment) {
    activePolicy = fromEnvironment;
    return getRedactionPolicy();
  }

  const value = await readWorkspaceSetting(REDACTION_FILE);
  if (value !== null) {
    const raw = value as Partial<PersistedRedactionPolicy>;
    if (raw.schemaVersion !== 1 || typeof raw.enabled !== "boolean") {
      throw new Error("Privacy settings have an unsupported format");
    }
    activePolicy = {
      enabled: raw.enabled,
      source: "workspace",
      locked: false,
      ...(typeof raw.updatedAt === "number" ? { updatedAt: raw.updatedAt } : {}),
    };
  } else {
    activePolicy = DEFAULT_POLICY;
  }
  return getRedactionPolicy();
}

export async function setRedactionEnabled(enabled: boolean): Promise<RedactionPolicy> {
  const fromEnvironment = environmentPolicy();
  if (fromEnvironment) {
    activePolicy = fromEnvironment;
    throw new RedactionPolicyLockedError();
  }

  const updatedAt = Date.now();
  const next: PersistedRedactionPolicy = { schemaVersion: 1, enabled, updatedAt };
  await writeWorkspaceSetting(REDACTION_FILE, next);
  activePolicy = { enabled, source: "workspace", locked: false, updatedAt };
  return getRedactionPolicy();
}

function isRedactionEnabled(): boolean {
  return activePolicy.enabled;
}

/** Visual pixels and accessibility text cannot currently be safely masked. */
export function visualEvidenceAllowed(policy: RedactionPolicy = getRedactionPolicy()): boolean {
  return !policy.enabled;
}

export function redactUrl(value: string): string {
  if (!isRedactionEnabled()) return value;
  return redactUrlContent(value);
}

export function redactText(value: string): string {
  if (!isRedactionEnabled()) return value;
  return redactTextContent(value);
}

export function redactValue(value: unknown, key = ""): unknown {
  return redactValueForEnabledPolicy(value, key, isRedactionEnabled());
}

export function redactResolvedInputs(inputs: Record<string, string>): Record<string, string> {
  if (!isRedactionEnabled()) return { ...inputs };
  return Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [
      key,
      redactionKeyIsSensitive(key) ? `${REDACTED}:${digestValue(value)}` : redactText(value),
    ]),
  );
}
