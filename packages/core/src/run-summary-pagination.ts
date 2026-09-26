import { captureReviewQueueForRun } from "./capture-review-queue.js";
import { runTestSource } from "./run-test-source.js";
import type { RunSummary } from "@relay/protocol";
import { catalogSummaryPage, rebuildRunCatalog } from "./run-catalog.js";
import type { PersistedRun } from "./runs.js";

const RUN_LIST_CURSOR_VERSION = 1;
const RUN_LIST_CURSOR_MAX_LENGTH = 512;
const RUN_LIST_PAGE_MAX = 200;
const MAX_PERSISTED_RUN_SCAN = 20_000;

type RunListCursor = {
  version: typeof RUN_LIST_CURSOR_VERSION;
  projectId: string;
  appMapId?: string;
  ownerId?: string;
  writtenAt: number;
  id: string;
};

export type RunSummaryPageInput = {
  limit?: number;
  appMapId?: string;
  cursor?: string;
  /** Binds the opaque cursor to the authenticated Relay project. */
  projectId: string;
  ownerId?: string;
  rootDirectory: string;
};

export type RunSummaryPage = {
  runs: RunSummary[];
  totalCount: number;
  nextCursor?: string;
};

export class RunListCursorError extends Error {
  readonly status = 400;

  constructor(message = "Run list cursor is invalid or no longer available") {
    super(message);
    this.name = "RunListCursorError";
  }
}

function encodeRunListCursor(input: Omit<RunListCursor, "version">): string {
  return Buffer.from(
    JSON.stringify({ version: RUN_LIST_CURSOR_VERSION, ...input }),
    "utf8",
  ).toString("base64url");
}

type RunLoader = (limit: number, actionPrefix?: string) => Promise<PersistedRun[]>;

export type PersistedRunSummaryPageInput = RunSummaryPageInput & {
  ownerId: string;
  loadRuns: RunLoader;
};

function persistedSummary(run: PersistedRun): RunSummary {
  return {
    ...(runTestSource(run) ? { sourceTest: runTestSource(run) } : {}),
    captureSummary: captureReviewQueueForRun(run).summary,
    id: run.id,
    action: run.action,
    ...(run.title ? { title: run.title } : {}),
    status: run.status,
    queuedAt: run.queuedAt,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    ...(run.durationMs === undefined ? {} : { durationMs: run.durationMs }),
    ...(run.platform ? { platform: run.platform } : {}),
    ...(run.serial ? { serial: run.serial } : {}),
    ...(run.targetProfile?.id ? { targetProfileId: run.targetProfile.id } : {}),
    ...(run.outcome ? { outcome: run.outcome } : {}),
    ...(run.sourceRevision ? { sourceRevision: run.sourceRevision } : {}),
    ...(run.review ? { review: run.review } : {}),
    ...(run.batchId ? { batchId: run.batchId } : {}),
    frameCount: run.frameCount ?? run.frames.length,
    evidenceComplete: Boolean(run.evidence?.finishedAt),
    writtenAt: run.writtenAt,
    artifactCount: run.artifacts.length,
    artifactBytes: run.frames.reduce((sum, frame) => sum + (frame.bytes ?? 0), 0),
    storageBytes: 0,
    pinned: false,
    retentionClass: "standard",
  };
}

function decodeRunListCursor(
  value: string,
  expected: Pick<RunListCursor, "projectId" | "appMapId" | "ownerId">,
): RunListCursor {
  if (value.length > RUN_LIST_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new RunListCursorError();
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new RunListCursorError();
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new RunListCursorError();
  }
  const candidate = decoded as Partial<RunListCursor>;
  const writtenAt = candidate.writtenAt;
  const id = candidate.id;
  if (
    candidate.version !== RUN_LIST_CURSOR_VERSION ||
    candidate.projectId !== expected.projectId ||
    candidate.appMapId !== expected.appMapId ||
    candidate.ownerId !== expected.ownerId ||
    typeof id !== "string" ||
    !id ||
    typeof writtenAt !== "number" ||
    !Number.isSafeInteger(writtenAt) ||
    writtenAt < 0
  ) {
    throw new RunListCursorError();
  }
  return {
    version: RUN_LIST_CURSOR_VERSION,
    projectId: candidate.projectId,
    ...(candidate.appMapId ? { appMapId: candidate.appMapId } : {}),
    ...(candidate.ownerId ? { ownerId: candidate.ownerId } : {}),
    writtenAt,
    id,
  };
}

/**
 * Return a bounded run-summary page using the catalog's stable
 * `(writtenAt DESC, id DESC)` keyset. The cursor carries the project and
 * App Map filter so it cannot be replayed against a different list.
 */
export async function listRunSummariesPageAtRoot(
  input: RunSummaryPageInput,
): Promise<RunSummaryPage> {
  const projectId = input.projectId.trim();
  if (!projectId) throw new TypeError("run list projectId is required");
  const appMapId = input.appMapId?.trim() || undefined;
  const limit = Number.isFinite(input.limit)
    ? Math.max(1, Math.min(Math.floor(input.limit!), RUN_LIST_PAGE_MAX))
    : 40;
  const cursor = input.cursor
    ? decodeRunListCursor(input.cursor, {
        projectId,
        appMapId,
        ownerId: input.ownerId,
      })
    : undefined;
  const root = input.rootDirectory;
  let page = await catalogSummaryPage(
    root,
    limit,
    undefined,
    cursor && { writtenAt: cursor.writtenAt, id: cursor.id },
    appMapId,
  );
  // Rebuild only a catalog that is empty overall. An App with no runs yet is
  // a normal empty page; rebuilding for it rescans every run on each request.
  const catalogEmpty =
    !cursor &&
    page.totalCount === 0 &&
    (!appMapId || (await catalogSummaryPage(root, 1)).totalCount === 0);
  if (catalogEmpty) {
    const catalog = await rebuildRunCatalog(root);
    if (catalog.indexed > 0) {
      page = await catalogSummaryPage(root, limit, undefined, undefined, appMapId);
    }
  }
  const next = page.nextCursor;
  return {
    runs: page.summaries,
    totalCount: page.totalCount,
    ...(next
      ? {
          nextCursor: encodeRunListCursor({
            projectId,
            ...(appMapId ? { appMapId } : {}),
            ...(input.ownerId ? { ownerId: input.ownerId } : {}),
            writtenAt: next.writtenAt,
            id: next.id,
          }),
        }
      : {}),
  };
}

/**
 * Project/owner-scoped fallback for authenticated callers that cannot use the
 * local summary catalog. The scan is deliberately capped so a large store
 * fails explicitly instead of silently returning an incomplete page.
 */
export async function listPersistedRunSummariesPageAtRoot(
  input: PersistedRunSummaryPageInput,
): Promise<RunSummaryPage> {
  const projectId = input.projectId.trim();
  const ownerId = input.ownerId.trim();
  if (!projectId || !ownerId) throw new TypeError("run list scope is required");
  const appMapId = input.appMapId?.trim() || undefined;
  const limit = Number.isFinite(input.limit)
    ? Math.max(1, Math.min(Math.floor(input.limit!), RUN_LIST_PAGE_MAX))
    : 40;
  const cursor = input.cursor
    ? decodeRunListCursor(input.cursor, { projectId, appMapId, ownerId })
    : undefined;
  const loaded = await input.loadRuns(MAX_PERSISTED_RUN_SCAN + 1, undefined);
  if (loaded.length > MAX_PERSISTED_RUN_SCAN) {
    throw new RunListCursorError("Run list is too large for the bounded server scan");
  }
  const filtered = loaded
    .filter(
      (run) =>
        run.projectId === projectId &&
        run.ownerId === ownerId &&
        (!appMapId ||
          runTestSource(run)?.appMapId === appMapId ||
          run.action.startsWith(`app-map:${appMapId}:`)),
    )
    .sort((left, right) => right.writtenAt - left.writtenAt || right.id.localeCompare(left.id));
  const remaining = cursor
    ? filtered.filter(
        (run) =>
          run.writtenAt < cursor.writtenAt ||
          (run.writtenAt === cursor.writtenAt && run.id < cursor.id),
      )
    : filtered;
  const page = remaining.slice(0, limit);
  const last = page.at(-1);
  return {
    runs: page.map(persistedSummary),
    totalCount: filtered.length,
    ...(last && page.length < remaining.length
      ? {
          nextCursor: encodeRunListCursor({
            projectId,
            ...(appMapId ? { appMapId } : {}),
            ownerId,
            writtenAt: last.writtenAt,
            id: last.id,
          }),
        }
      : {}),
  };
}
