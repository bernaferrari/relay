import type { TestData } from "@relay/protocol";

const STORAGE_PREFIX = "relay.variable-pending-draft.v1";

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isTestData(value: unknown): value is TestData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TestData>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.scope === "shared" || candidate.scope === "private") &&
    (candidate.source === "static" ||
      candidate.source === "list" ||
      candidate.source === "generated") &&
    (candidate.prompt === undefined || typeof candidate.prompt === "string") &&
    (candidate.values === undefined || isStringArray(candidate.values)) &&
    (candidate.fallback === undefined || typeof candidate.fallback === "string") &&
    (candidate.sensitive === undefined || typeof candidate.sensitive === "boolean")
  );
}

/** Keep the last unsent project-data value recoverable across workspace cleanup. */
export function readPendingDataWorkspaceDraft(projectId: string): TestData[] | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "null") as unknown;
    return Array.isArray(value) && value.every(isTestData) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writePendingDataWorkspaceDraft(projectId: string, value: TestData[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(value));
  } catch {
    // Storage can be unavailable in restricted browser contexts. The canonical
    // save still runs; this best-effort recovery layer must never block editing.
  }
}

export function removePendingDataWorkspaceDraft(projectId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey(projectId));
  } catch {
    // Keep cleanup best-effort for the same restricted-storage environments.
  }
}
