import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AuthoringEvidence, JourneyMetadata, Revisioned } from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import { findWorkspaceRoot } from "./workspace-root.js";

export type JourneyAggregate = {
  schemaVersion: 1;
  organizationId: string;
  projectId: string;
  journeyId: string;
  transactionId: string;
  committedAt: number;
  recipe: Recipe;
  document: Revisioned<JourneyMetadata>;
  evidence: AuthoringEvidence[];
  digest: string;
};

function stateRoot(): string {
  return (
    (process.env.RELAY_STATE_DIR ?? process.env.GROK_DEVICE_STATE_DIR)?.trim() ||
    join(findWorkspaceRoot(), ".relay")
  );
}

function safe(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`${label} contains invalid characters`);
  return value;
}

function aggregateDirectory(): string {
  return join(stateRoot(), "journey-aggregates");
}

function aggregatePath(projectId: string, journeyId: string): string {
  return join(
    aggregateDirectory(),
    `${safe(projectId, "projectId")}--${safe(journeyId, "journeyId")}.json`,
  );
}

function evidenceDirectory(): string {
  return join(stateRoot(), "authoring-evidence");
}

async function writeDurably(path: string, data: Uint8Array | string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function aggregateDigest(value: Omit<JourneyAggregate, "digest">): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function parseAggregate(value: unknown): JourneyAggregate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<JourneyAggregate>;
  if (
    input.schemaVersion !== 1 ||
    typeof input.projectId !== "string" ||
    typeof input.journeyId !== "string" ||
    typeof input.transactionId !== "string" ||
    typeof input.committedAt !== "number" ||
    !input.recipe ||
    !input.document ||
    !Array.isArray(input.evidence) ||
    typeof input.digest !== "string"
  )
    return null;
  const { digest, ...body } = input as JourneyAggregate;
  return aggregateDigest(body) === digest ? (input as JourneyAggregate) : null;
}

export async function readJourneyAggregate(
  projectId: string,
  journeyId: string,
): Promise<JourneyAggregate | null> {
  try {
    return parseAggregate(JSON.parse(await readFile(aggregatePath(projectId, journeyId), "utf8")));
  } catch {
    return null;
  }
}

export async function deleteJourneyAggregate(projectId: string, journeyId: string): Promise<void> {
  await unlink(aggregatePath(projectId, journeyId)).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  });
}

export async function listJourneyAggregates(projectId = "default"): Promise<JourneyAggregate[]> {
  let names: string[];
  try {
    names = await readdir(aggregateDirectory());
  } catch {
    return [];
  }
  const prefix = `${safe(projectId, "projectId")}--`;
  const aggregates = await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .map(async (name) => {
        try {
          return parseAggregate(
            JSON.parse(await readFile(join(aggregateDirectory(), basename(name)), "utf8")),
          );
        } catch {
          return null;
        }
      }),
  );
  return aggregates.filter((value): value is JourneyAggregate => Boolean(value));
}

export async function persistAuthoringEvidence(input: {
  kind: AuthoringEvidence["kind"];
  capturedAt: number;
  data: Uint8Array | string;
  mime?: string;
  startMs?: number;
  endMs?: number;
}): Promise<AuthoringEvidence> {
  const bytes = typeof input.data === "string" ? Buffer.from(input.data, "utf8") : input.data;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(evidenceDirectory(), { recursive: true, mode: 0o700 });
  const destination = join(evidenceDirectory(), sha256);
  try {
    await writeDurably(destination, bytes);
    await syncDirectory(evidenceDirectory());
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  return {
    id: `evidence-${sha256.slice(0, 24)}`,
    kind: input.kind,
    capturedAt: input.capturedAt,
    uri: `relay-evidence://${sha256}`,
    bytes: bytes.byteLength,
    sha256,
    ...(input.mime ? { mime: input.mime } : {}),
    ...(input.startMs !== undefined ? { startMs: input.startMs } : {}),
    ...(input.endMs !== undefined ? { endMs: input.endMs } : {}),
  };
}

export async function authoringEvidenceExists(evidence: AuthoringEvidence): Promise<boolean> {
  const sha = evidence.uri.match(/^relay-evidence:\/\/([a-f0-9]{64})$/)?.[1];
  if (!sha || evidence.sha256 !== sha) return false;
  try {
    const bytes = await readFile(join(evidenceDirectory(), sha));
    return (
      createHash("sha256").update(bytes).digest("hex") === sha &&
      (evidence.bytes === undefined || evidence.bytes === bytes.byteLength)
    );
  } catch {
    return false;
  }
}

export async function readAuthoringEvidence(sha256: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
  try {
    return await readFile(join(evidenceDirectory(), sha256));
  } catch {
    return null;
  }
}

/**
 * One atomic visibility point for executable steps, the Journey graph, and
 * immutable evidence references. Evidence is written first and may be orphaned
 * by a crash; the aggregate appears only after every reference is durable.
 */
export async function commitJourneyAggregate(input: {
  organizationId: string;
  projectId: string;
  journeyId: string;
  transactionId?: string;
  recipe: Recipe;
  document: Revisioned<JourneyMetadata>;
  evidence: AuthoringEvidence[];
  fault?: (boundary: "before-verify" | "after-verify" | "before-rename" | "after-rename") => void;
}): Promise<JourneyAggregate> {
  input.fault?.("before-verify");
  const stepIds = new Set(input.recipe.steps.flatMap((step) => (step.id ? [step.id] : [])));
  const evidenceIds = new Set(input.evidence.map((evidence) => evidence.id));
  for (const transition of input.document.value.graph?.transitions ?? []) {
    for (const stepId of transition.stepIds) {
      if (!stepIds.has(stepId)) {
        throw new Error(`Journey connection ${transition.id} references missing step ${stepId}`);
      }
    }
    if (transition.provenance?.source === "recording" && !transition.evidenceIds?.length) {
      throw new Error(`Recorded Journey connection ${transition.id} has no committed evidence`);
    }
    for (const evidenceId of transition.evidenceIds ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(
          `Journey connection ${transition.id} references missing evidence ${evidenceId}`,
        );
      }
    }
  }
  for (const evidence of input.evidence) {
    if (!(await authoringEvidenceExists(evidence))) {
      throw new Error(`Authoring evidence ${evidence.id} is not durable`);
    }
  }
  input.fault?.("after-verify");
  const body: Omit<JourneyAggregate, "digest"> = {
    schemaVersion: 1,
    organizationId: input.organizationId,
    projectId: input.projectId,
    journeyId: input.journeyId,
    transactionId: input.transactionId ?? randomUUID(),
    committedAt: Date.now(),
    recipe: structuredClone(input.recipe),
    document: structuredClone(input.document),
    evidence: structuredClone(input.evidence),
  };
  const aggregate: JourneyAggregate = { ...body, digest: aggregateDigest(body) };
  await mkdir(aggregateDirectory(), { recursive: true, mode: 0o700 });
  const destination = aggregatePath(input.projectId, input.journeyId);
  const staged = `${destination}.${process.pid}.${randomUUID()}.staged`;
  try {
    await writeDurably(staged, JSON.stringify(aggregate, null, 2));
    input.fault?.("before-rename");
    await rename(staged, destination);
    await syncDirectory(aggregateDirectory());
    input.fault?.("after-rename");
    return aggregate;
  } finally {
    await unlink(staged).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
}
