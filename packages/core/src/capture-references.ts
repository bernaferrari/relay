/**
 * Reference screenshots: "Accept as reference" makes a capture the reference for its
 * checkpoint, and later runs are compared with it. Unchanged captures are
 * approved automatically so people only review what actually changed.
 *
 * Scope of one reference: project + Test (without revision) + target profile
 * (device/browser and viewport) + capture slot family (checkpoint, data
 * configuration, iteration, phase, and authored criterion — never the retry attempt).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  CAPTURE_REFERENCE_ACTOR,
  CAPTURE_REFERENCE_DEFAULTS,
  captureReviewSlotFamilyId,
  decidedByReference,
  isCaptureReferenceRegion,
  type CaptureReferenceComparison,
  type CaptureReferenceRegion,
  type CaptureReviewDecision,
  type CaptureReviewItem,
} from "@relay/protocol";
import { captureReviewQueueForRun } from "./capture-review-queue.js";
import { readFrameFile } from "./run-artifact-files.js";
import { runTestSource } from "./run-test-source.js";
import {
  persistPersistedRun,
  readCompletedPersistedRun,
  withRunWriteLock,
  type PersistedRun,
} from "./runs.js";

export type CaptureReference = {
  schemaVersion: 1;
  id: string;
  /** Stable scope key; one current reference per key. */
  key: string;
  projectKey: string;
  testKey: string;
  targetKey: string;
  slotKey: string;
  caption: string;
  sha256: string;
  width: number;
  height: number;
  /** Relative to the runs root. */
  artifactPath: string;
  runId: string;
  captureId: string;
  approvedAt: number;
  approvedBy: { id: string; kind: "human" | "agent" | "system" };
  ignoreRegions: CaptureReferenceRegion[];
  /** Set when the approval was withdrawn; the previous reference applies again. */
  revokedAt?: number;
};

/** Older references kept per checkpoint so a withdrawn approval can roll back. */
const HISTORY_PER_KEY = 5;

function current(references: readonly CaptureReference[], key: string) {
  for (let index = references.length - 1; index >= 0; index -= 1) {
    const reference = references[index]!;
    if (reference.key === key && !reference.revokedAt) return reference;
  }
  return undefined;
}

function trimHistory(references: CaptureReference[], key: string): CaptureReference[] {
  const forKey = references.filter((reference) => reference.key === key);
  const drop = new Set(forKey.slice(0, Math.max(0, forKey.length - HISTORY_PER_KEY)));
  return references.filter((reference) => !drop.has(reference));
}

const REFERENCES_FILE = ".capture-references.json";
const REFERENCE_ARTIFACTS = ".capture-reference-artifacts";
const writeQueues = new Map<string, Promise<unknown>>();

type ReferenceRun = Pick<
  PersistedRun,
  "action" | "projectId" | "targetProfile" | "serial" | "platform" | "artifacts"
>;

function projectKey(run: Pick<PersistedRun, "projectId">): string {
  return run.projectId?.trim() || "local";
}

function testKey(run: Pick<PersistedRun, "action" | "artifacts">): string {
  const source = runTestSource(run);
  return source ? `${source.appMapId}/${source.testId}` : run.action;
}

function targetKey(run: Pick<PersistedRun, "targetProfile" | "serial" | "platform">): string {
  return run.targetProfile?.id ?? run.serial ?? run.platform ?? "default";
}

/** Checkpoint identity without the retry attempt; falls back to step, then caption. */
export function captureReferenceSlotKey(item: CaptureReviewItem): string {
  const criterion = createHash("sha256")
    .update(JSON.stringify({ lookFor: item.lookFor?.trim() ?? "", policy: item.policy ?? null }))
    .digest("hex")
    .slice(0, 16);
  if (item.checkpointId) {
    return `${captureReviewSlotFamilyId({
      checkpointId: item.checkpointId,
      ...(item.requirementId ? { requirementId: item.requirementId } : {}),
      ...(item.configuration ? { configuration: item.configuration } : {}),
      ...(item.invocation ? { invocation: item.invocation } : {}),
      ...(item.iteration !== undefined ? { iteration: item.iteration } : {}),
      ...(item.phase ? { phase: item.phase } : {}),
    })}:criterion:${criterion}`;
  }
  if (item.stepId) return `step:${item.stepId}:criterion:${criterion}`;
  return `caption:${item.caption.trim().toLowerCase()}:criterion:${criterion}`;
}

function referenceKey(run: ReferenceRun, slotKey: string): string {
  return createHash("sha256")
    .update(
      ["capture-reference-policy:v2", projectKey(run), testKey(run), targetKey(run), slotKey].join(
        "\n",
      ),
    )
    .digest("hex")
    .slice(0, 32);
}

function isReference(value: unknown): value is CaptureReference {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.schemaVersion === 1 &&
    typeof item.id === "string" &&
    typeof item.key === "string" &&
    typeof item.sha256 === "string" &&
    typeof item.artifactPath === "string" &&
    typeof item.width === "number" &&
    typeof item.height === "number" &&
    Array.isArray(item.ignoreRegions) &&
    item.ignoreRegions.every(isCaptureReferenceRegion)
  );
}

async function readReferences(root: string): Promise<CaptureReference[]> {
  try {
    const value: unknown = JSON.parse(await readFile(join(root, REFERENCES_FILE), "utf8"));
    return Array.isArray(value) ? value.filter(isReference) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeReferences(root: string, references: readonly CaptureReference[]) {
  await mkdir(root, { recursive: true });
  const target = join(root, REFERENCES_FILE);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(references, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function serialize<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  writeQueues.set(root, next);
  void next
    .finally(() => {
      if (writeQueues.get(root) === next) writeQueues.delete(root);
    })
    .catch(() => undefined);
  return next;
}

export async function findCaptureReference(
  root: string,
  run: ReferenceRun,
  item: CaptureReviewItem,
): Promise<CaptureReference | undefined> {
  return current(await readReferences(root), referenceKey(run, captureReferenceSlotKey(item)));
}

export async function readCaptureReferenceImage(
  root: string,
  reference: CaptureReference,
): Promise<Buffer | null> {
  try {
    return await readFile(join(root, reference.artifactPath));
  } catch {
    return null;
  }
}

/** Make this capture the reference for its checkpoint. Keeps prior ignore areas. */
export async function setCaptureReference(
  root: string,
  run: ReferenceRun & Pick<PersistedRun, "id" | "dir">,
  item: CaptureReviewItem,
  approvedBy: CaptureReference["approvedBy"],
  expectedReferenceId: string | null,
): Promise<CaptureReference | undefined | null> {
  if (!item.framePath || item.status === "missing") return undefined;
  const bytes = await readFrameFile(run.dir, item.framePath);
  if (!bytes) return undefined;
  let png: { width: number; height: number };
  try {
    png = PNG.sync.read(bytes);
  } catch {
    return undefined;
  }
  const slotKey = captureReferenceSlotKey(item);
  const key = referenceKey(run, slotKey);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return serialize(root, async () => {
    const references = await readReferences(root);
    const prior = current(references, key);
    // A review may be persisted before its image write succeeds. Its retry may
    // finish only while the reference generation it reviewed is still current.
    if (prior?.runId === run.id && prior.captureId === item.captureId && prior.sha256 === sha256)
      return prior;
    if ((prior?.id ?? null) !== expectedReferenceId) return null;
    if (prior?.sha256 === sha256) return prior;
    const id = `capture-reference-${randomUUID()}`;
    const artifactPath = join(REFERENCE_ARTIFACTS, `${id}.png`);
    await mkdir(join(root, REFERENCE_ARTIFACTS), { recursive: true });
    await writeFile(join(root, artifactPath), bytes);
    const next: CaptureReference = {
      schemaVersion: 1,
      id,
      key,
      projectKey: projectKey(run),
      testKey: testKey(run),
      targetKey: targetKey(run),
      slotKey,
      caption: item.caption,
      sha256,
      width: png.width,
      height: png.height,
      artifactPath,
      runId: run.id,
      captureId: item.captureId,
      approvedAt: Date.now(),
      approvedBy,
      ignoreRegions: prior?.ignoreRegions ?? [],
    };
    await writeReferences(root, trimHistory([...references, next], key));
    return next;
  });
}

/**
 * The person withdrew "Looks correct" for this exact capture. If it is the
 * current reference, the previous one applies again.
 */
export async function revokeCaptureReference(
  root: string,
  run: ReferenceRun & Pick<PersistedRun, "id">,
  item: CaptureReviewItem,
): Promise<boolean> {
  const key = referenceKey(run, captureReferenceSlotKey(item));
  return serialize(root, async () => {
    const references = await readReferences(root);
    const active = current(references, key);
    if (!active || active.runId !== run.id || active.captureId !== item.captureId) return false;
    await writeReferences(
      root,
      references.map((reference) =>
        reference === active ? { ...reference, revokedAt: Date.now() } : reference,
      ),
    );
    return true;
  });
}

export async function updateCaptureReferenceIgnoreRegions(
  root: string,
  run: ReferenceRun,
  item: CaptureReviewItem,
  regions: readonly CaptureReferenceRegion[],
): Promise<CaptureReference | undefined> {
  if (regions.length > 50 || !regions.every(isCaptureReferenceRegion)) {
    throw new TypeError("Ignore areas must be at most 50 rectangles inside the screenshot.");
  }
  const key = referenceKey(run, captureReferenceSlotKey(item));
  return serialize(root, async () => {
    const references = await readReferences(root);
    const active = current(references, key);
    if (!active) return undefined;
    const next = { ...active, ignoreRegions: regions.map((region) => ({ ...region })) };
    await writeReferences(
      root,
      references.map((reference) => (reference === active ? next : reference)),
    );
    return next;
  });
}

type Decoded = { width: number; height: number; data: Buffer };

function inside(regions: readonly CaptureReferenceRegion[], x: number, y: number): boolean {
  return regions.some(
    (region) =>
      x >= region.x &&
      y >= region.y &&
      x <= region.x + region.width &&
      y <= region.y + region.height,
  );
}

/** Pixel comparison; also returns a mask of changed pixels for diff images. */
export function compareCaptureImages(
  reference: Decoded,
  latest: Decoded,
  ignoreRegions: readonly CaptureReferenceRegion[] = [],
  options: { pixelThreshold?: number; changeThreshold?: number } = {},
): {
  changed: boolean;
  comparable: boolean;
  sizeChanged: boolean;
  changeRatio: number;
  consideredPixels: number;
  ignoredPixels: number;
  changedPixels: number;
  pixelThreshold: number;
  changeThreshold: number;
  changedBounds?: CaptureReferenceRegion;
  mask?: Uint8Array;
} {
  const pixelThreshold = options.pixelThreshold ?? CAPTURE_REFERENCE_DEFAULTS.pixelThreshold;
  const changeThreshold = options.changeThreshold ?? CAPTURE_REFERENCE_DEFAULTS.changeThreshold;
  if (reference.width !== latest.width || reference.height !== latest.height) {
    return {
      changed: true,
      comparable: true,
      sizeChanged: true,
      changeRatio: 1,
      consideredPixels: 0,
      ignoredPixels: 0,
      changedPixels: 0,
      pixelThreshold,
      changeThreshold,
    };
  }
  const { width, height } = latest;
  const mask = new Uint8Array(width * height);
  let considered = 0;
  let changedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      if (ignoreRegions.length && inside(ignoreRegions, (x + 0.5) / width, ny)) {
        mask[y * width + x] = 2;
        continue;
      }
      considered += 1;
      const offset = (y * width + x) * 4;
      let differs = false;
      for (let channel = 0; channel < 4; channel += 1) {
        if (
          Math.abs(latest.data[offset + channel]! - reference.data[offset + channel]!) >
          pixelThreshold
        ) {
          differs = true;
          break;
        }
      }
      if (!differs) continue;
      mask[y * width + x] = 1;
      changedPixels += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const changeRatio = considered === 0 ? 0 : changedPixels / considered;
  return {
    changed: changeRatio > changeThreshold,
    comparable: considered > 0,
    sizeChanged: false,
    changeRatio,
    consideredPixels: considered,
    ignoredPixels: width * height - considered,
    changedPixels,
    pixelThreshold,
    changeThreshold,
    mask,
    ...(changedPixels
      ? {
          changedBounds: {
            x: minX / width,
            y: minY / height,
            width: (maxX - minX + 1) / width,
            height: (maxY - minY + 1) / height,
          },
        }
      : {}),
  };
}

/**
 * Diff image: the new screenshot dimmed and desaturated, changed pixels in
 * magenta, ignored areas hatched. Mismatched sizes show the new screenshot.
 */
export function renderCaptureDiff(
  reference: Decoded,
  latest: Decoded,
  ignoreRegions: readonly CaptureReferenceRegion[] = [],
): Buffer {
  const result = compareCaptureImages(reference, latest, ignoreRegions);
  const out = new PNG({ width: latest.width, height: latest.height });
  for (let index = 0; index < latest.width * latest.height; index += 1) {
    const offset = index * 4;
    const gray =
      0.299 * latest.data[offset]! +
      0.587 * latest.data[offset + 1]! +
      0.114 * latest.data[offset + 2]!;
    const state = result.mask?.[index] ?? 0;
    if (state === 1) {
      out.data[offset] = 255;
      out.data[offset + 1] = 0;
      out.data[offset + 2] = 170;
    } else if (state === 2) {
      const x = index % latest.width;
      const y = Math.floor(index / latest.width);
      const stripe = (x + y) % 12 < 2;
      const value = stripe ? 160 : 60 + gray * 0.2;
      out.data[offset] = value;
      out.data[offset + 1] = value;
      out.data[offset + 2] = stripe ? 200 : value;
    } else {
      const value = 40 + gray * 0.45;
      out.data[offset] = value;
      out.data[offset + 1] = value;
      out.data[offset + 2] = value;
    }
    out.data[offset + 3] = 255;
  }
  return PNG.sync.write(out);
}

async function compareItem(
  root: string,
  run: ReferenceRun & Pick<PersistedRun, "dir">,
  item: CaptureReviewItem,
  references: readonly CaptureReference[],
): Promise<CaptureReferenceComparison | undefined> {
  if (item.status === "missing" || !item.framePath) return undefined;
  const reference = current(references, referenceKey(run, captureReferenceSlotKey(item)));
  const comparedAt = Date.now();
  if (!reference) return { state: "new", comparedAt };
  const described = {
    comparedAt,
    referenceId: reference.id,
    referenceRunId: reference.runId,
    referenceApprovedAt: reference.approvedAt,
    referenceApprovedBy: reference.approvedBy,
    ...(reference.ignoreRegions.length ? { ignoreRegions: reference.ignoreRegions } : {}),
  };
  const latestBytes = await readFrameFile(run.dir, item.framePath);
  if (!latestBytes) return undefined;
  const referenceBytes = await readCaptureReferenceImage(root, reference);
  if (!referenceBytes) return { state: "new", comparedAt };
  const diff = compareCaptureImages(
    PNG.sync.read(referenceBytes),
    PNG.sync.read(latestBytes),
    reference.ignoreRegions,
  );
  return {
    state: !diff.comparable ? "incomparable" : diff.changed ? "changed" : "match",
    ...(diff.comparable ? { changeRatio: diff.changeRatio } : {}),
    consideredPixels: diff.consideredPixels,
    ignoredPixels: diff.ignoredPixels,
    changedPixels: diff.changedPixels,
    pixelThreshold: diff.pixelThreshold,
    changeThreshold: diff.changeThreshold,
    ...(diff.sizeChanged ? { sizeChanged: true } : {}),
    ...(diff.changedBounds ? { changedBounds: diff.changedBounds } : {}),
    ...described,
  };
}

/**
 * Compare every capture of a completed run with its reference, persist the
 * comparisons on the run, and approve unchanged captures that nobody decided
 * yet. A person's decision is never replaced.
 *
 * People review only what changed: unless a Plan explicitly asks for human
 * review of every capture, a capture that matches its approved reference is
 * accepted, a first capture on a passing run is accepted, and only a capture
 * that differs from its reference waits for a person.
 */
export async function applyCaptureReferences(
  root: string,
  run: PersistedRun,
): Promise<PersistedRun> {
  return withRunWriteLock(run.dir, async () => {
    const latest = (await readCompletedPersistedRun(run.dir)) ?? run;
    latest.dir = run.dir;
    if ((latest.referenceReviewMode ?? "approved-reference") !== "approved-reference")
      return latest;
    const queue = captureReviewQueueForRun(latest);
    if (!queue.items.length) return latest;
    const references = await readReferences(root);
    const comparisons: Record<string, CaptureReferenceComparison> = {};
    for (const item of queue.items) {
      try {
        const comparison = await compareItem(root, latest, item, references);
        if (comparison) comparisons[item.captureId] = comparison;
      } catch {
        // An unreadable or corrupt image stays in the person's queue.
      }
    }
    const decisions = [...(latest.captureReviews ?? [])];
    for (const item of queue.items) {
      const comparison = comparisons[item.captureId];
      const human = decisions.find(
        (decision) =>
          decision.captureId === item.captureId && !decidedByReference(decision.decidedBy),
      );
      const index = decisions.findIndex(
        (decision) =>
          decision.captureId === item.captureId && decidedByReference(decision.decidedBy),
      );
      if (human) continue;
      const firstOnPass = comparison?.state === "new" && latest.outcome === "passed";
      // The first passing capture becomes the baseline, so later changes are caught.
      if (firstOnPass) {
        await setCaptureReference(root, latest, item, { ...CAPTURE_REFERENCE_ACTOR }, null).catch(
          () => undefined,
        );
      }
      if (comparison?.state === "match" || firstOnPass) {
        const decision: CaptureReviewDecision = {
          captureId: item.captureId,
          action: "accept",
          decidedAt: comparison.comparedAt,
          decidedBy: { ...CAPTURE_REFERENCE_ACTOR },
          ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
          note: firstOnPass
            ? "No reference yet; accepted with a passing run."
            : "Matches the approved reference.",
          reviewVersion: 0,
        };
        if (index >= 0) decisions[index] = decision;
        else decisions.push(decision);
      } else if (index >= 0) {
        decisions.splice(index, 1);
      }
    }
    const next: PersistedRun = structuredClone(latest);
    next.captureComparisons = comparisons;
    next.captureReviews = decisions;
    if (
      JSON.stringify(latest.captureComparisons ?? {}) === JSON.stringify(comparisons) &&
      JSON.stringify(latest.captureReviews ?? []) === JSON.stringify(decisions)
    ) {
      return latest;
    }
    return persistPersistedRun(root, latest, next, "reference");
  });
}

/** Copy of a reference image path for a capture, if any (used by routes). */
export async function captureReferenceImageForItem(
  root: string,
  run: ReferenceRun,
  item: CaptureReviewItem,
): Promise<{ reference: CaptureReference; bytes: Buffer } | undefined> {
  const reference = await findCaptureReference(root, run, item);
  if (!reference) return undefined;
  const bytes = await readCaptureReferenceImage(root, reference);
  return bytes ? { reference, bytes } : undefined;
}

export async function captureDiffImageForItem(
  root: string,
  run: ReferenceRun & Pick<PersistedRun, "dir">,
  item: CaptureReviewItem,
): Promise<Buffer | undefined> {
  if (!item.framePath) return undefined;
  const found = await captureReferenceImageForItem(root, run, item);
  const latest = await readFrameFile(run.dir, item.framePath);
  if (!found || !latest) return undefined;
  return renderCaptureDiff(
    PNG.sync.read(found.bytes),
    PNG.sync.read(latest),
    found.reference.ignoreRegions,
  );
}
