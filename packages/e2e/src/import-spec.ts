import { createHash, randomUUID } from "node:crypto";
import { link, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Artifact } from "./artifacts.js";

export type CaptureObligation = {
  id: string;
  testId: string;
  targetId: string;
  stepLabel: string;
  /** One-based invocation among screenshots with this label in the final attempt. */
  occurrence?: number;
  agent?: string;
  repeat?: number;
};
export type ImportOptions = {
  directory: string;
  obligations?: readonly CaptureObligation[];
  requireHumanReview?: boolean;
  /** Optional diagnostics do not block screenshot review unless explicitly required. */
  requiredArtifactKinds?: readonly Artifact["kind"][];
  maxArtifactBytes?: number;
};
export type ImportRequirements = {
  obligations?: CaptureObligation[];
  requireHumanReview: boolean;
  requiredArtifactKinds: Artifact["kind"][];
  maxArtifactBytes: number;
};

export function importRequirements(options: ImportOptions): ImportRequirements {
  if (options.requireHumanReview !== undefined && typeof options.requireHumanReview !== "boolean")
    throw new Error("Human review policy must be a boolean");
  if (
    options.maxArtifactBytes !== undefined &&
    (!Number.isSafeInteger(options.maxArtifactBytes) || options.maxArtifactBytes < 1)
  )
    throw new Error("Artifact limit must be a positive integer");
  if (
    options.requiredArtifactKinds !== undefined &&
    (!Array.isArray(options.requiredArtifactKinds) ||
      options.requiredArtifactKinds.some(
        (kind) => !["screenshot", "video", "log", "download"].includes(kind),
      ))
  )
    throw new Error("Invalid required artifact kind");
  if (options.obligations !== undefined && !Array.isArray(options.obligations))
    throw new Error("Capture obligations must be an array");
  const ids = new Set<string>();
  const selectors = new Set<string>();
  const obligations = options.obligations?.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid capture obligation");
    if (item.agent !== undefined && (typeof item.agent !== "string" || !item.agent.trim()))
      throw new Error("Capture agent must be a nonempty string");
    for (const key of ["id", "testId", "targetId", "stepLabel"] as const)
      if (typeof item[key] !== "string" || !item[key].trim())
        throw new Error(`Capture obligation requires ${key}`);
    if (ids.has(item.id)) throw new Error("Duplicate capture obligation id");
    ids.add(item.id);
    if (
      item.occurrence !== undefined &&
      (!Number.isInteger(item.occurrence) || item.occurrence < 1)
    )
      throw new Error("Capture occurrence must be a positive integer");
    if (item.repeat !== undefined && (!Number.isInteger(item.repeat) || item.repeat < 0))
      throw new Error("Capture repeat must be a non-negative integer");
    const normalized: CaptureObligation = {
      id: item.id,
      testId: item.testId,
      targetId: item.targetId,
      stepLabel: item.stepLabel,
      ...(item.occurrence === undefined ? {} : { occurrence: item.occurrence }),
      ...(item.agent === undefined ? {} : { agent: item.agent }),
      ...(item.repeat === undefined ? {} : { repeat: item.repeat }),
    };
    const selector = JSON.stringify({ ...normalized, id: undefined });
    if (selectors.has(selector))
      throw new Error("Duplicate capture selector; declare an occurrence");
    selectors.add(selector);
    return normalized;
  });
  return {
    ...(obligations === undefined
      ? {}
      : { obligations: obligations.sort((a, b) => a.id.localeCompare(b.id)) }),
    requireHumanReview: options.requireHumanReview ?? true,
    maxArtifactBytes: options.maxArtifactBytes ?? 64 * 1024 * 1024,
    requiredArtifactKinds: [
      ...new Set<Artifact["kind"]>(
        options.requiredArtifactKinds ?? (obligations ? [] : ["screenshot"]),
      ),
    ].sort(),
  };
}

/** Atomic publication gives concurrent deliveries one immutable execution/import identity. */
export async function freezeImportSpec(
  directory: string,
  runId: string,
  reportHash: string,
  options: ImportOptions,
  signal: AbortSignal,
) {
  const requirements = importRequirements(options);
  const requirementsHash = createHash("sha256").update(JSON.stringify(requirements)).digest("hex");
  const spec = {
    schemaVersion: "relay-e2e-import-spec-1",
    runId,
    reportHash,
    requirementsHash,
    requirements,
  };
  const path = resolve(directory, "import-spec.json");
  const candidate = `${path}.${randomUUID()}.candidate`;
  try {
    const retained = JSON.parse(await readFile(path, "utf8"));
    if (JSON.stringify(retained) !== JSON.stringify(spec))
      throw new Error(
        "Conflicting import requirements or report; use an explicit new import revision",
      );
    return spec;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  // A legacy receipt is already an authority decision. Do not silently replace its policy.
  try {
    const old = JSON.parse(await readFile(resolve(directory, "receipt.json"), "utf8"));
    if (!old.requirementsHash) {
      const prior = importRequirements({
        directory,
        requireHumanReview: old.acceptance.humanReview === "pending",
        ...(old.coverage.declared ? { obligations: old.coverage.obligations } : {}),
      });
      if (JSON.stringify(prior) !== JSON.stringify(requirements))
        throw new Error("Import requirements conflict with the retained legacy receipt");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  try {
    await writeFile(candidate, JSON.stringify(spec, null, 2), { mode: 0o600, signal });
    signal.throwIfAborted();
    try {
      await link(candidate, path);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const retained = JSON.parse(await readFile(path, "utf8"));
    if (JSON.stringify(retained) !== JSON.stringify(spec))
      throw new Error(
        "Conflicting import requirements or report; use an explicit new import revision",
      );
    return spec;
  } finally {
    await rm(candidate, { force: true });
  }
}
