import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
  type Variables,
} from "@modelcontextprotocol/server";
import {
  enrichCaptureReviewObservedSession,
  isCaptureReviewOpenerCaption,
  isCaptureReviewLeftoverCaption,
  liveCaptureReviewAccount,
  projectCaptureReviewDestIdentity,
  destIdentityReviewItems,
  type OperationId,
  type CaptureReviewObservedSession,
} from "@relay/protocol";
import type { OperationInvoker } from "./server.js";
import { readResult, relayMcpResourceMimeType } from "./resource-encoding.js";
import type { RelayMcpProfile, RelayMcpToolDescriptor } from "./tools.js";

export type RelayResourceScope = {
  projectId: string;
};

/**
 * MCP does not require a resource implementation to expose an unbounded
 * collection. Keep each page small enough to survive the resource byte limit
 * and carry an opaque continuation URI in the page metadata instead.
 */
export const relayMcpResourcePageSize = 100;
const resourceCursorVersion = 1;
const resourceCursorPattern = /^[A-Za-z0-9_-]{1,512}$/u;

type ResourceCursor = {
  version: typeof resourceCursorVersion;
  resource: string;
  projectId: string;
  profile: RelayMcpProfile;
  offset: number;
  backendCursor?: string;
};

function encodeResourceCursor(
  resource: string,
  scope: RelayResourceScope,
  profile: RelayMcpProfile,
  offset: number,
  backendCursor?: string,
): string {
  const value: ResourceCursor = {
    version: resourceCursorVersion,
    resource,
    projectId: scope.projectId,
    profile,
    offset,
    ...(backendCursor ? { backendCursor } : {}),
  };
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function cursorForUri(
  uri: URL,
  resource: string,
  scope: RelayResourceScope,
  profile: RelayMcpProfile,
): { offset: number; backendCursor?: string } {
  const queryKeys = [...uri.searchParams.keys()];
  if (
    uri.hash ||
    queryKeys.some((key) => key !== "cursor") ||
    uri.searchParams.getAll("cursor").length > 1
  ) {
    throw new ResourceNotFoundError(uri.href, `Unsafe Relay resource URI ${uri.href}`);
  }
  if (!uri.searchParams.has("cursor")) return { offset: 0 };
  const value = uri.searchParams.get("cursor");
  if (!value) {
    throw new ResourceNotFoundError(uri.href, `Invalid Relay resource cursor in ${uri.href}`);
  }
  if (!resourceCursorPattern.test(value)) {
    throw new ResourceNotFoundError(uri.href, `Invalid Relay resource cursor in ${uri.href}`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new ResourceNotFoundError(uri.href, `Invalid Relay resource cursor in ${uri.href}`);
  }
  const candidate = object(decoded);
  if (
    candidate.version !== resourceCursorVersion ||
    candidate.resource !== resource ||
    candidate.projectId !== scope.projectId ||
    candidate.profile !== profile ||
    !Number.isSafeInteger(candidate.offset) ||
    Number(candidate.offset) < 0 ||
    (candidate.backendCursor !== undefined &&
      (typeof candidate.backendCursor !== "string" || !candidate.backendCursor))
  ) {
    throw new ResourceNotFoundError(uri.href, `Invalid Relay resource cursor in ${uri.href}`);
  }
  return {
    offset: Number(candidate.offset),
    ...(typeof candidate.backendCursor === "string"
      ? { backendCursor: candidate.backendCursor }
      : {}),
  };
}

export function pageFromCursor(
  uri: URL,
  resource: string,
  scope: RelayResourceScope,
  profile: RelayMcpProfile,
): number | undefined {
  const cursor = uri.searchParams.has("cursor")
    ? cursorForUri(uri, resource, scope, profile).offset
    : undefined;
  if (cursor === undefined || cursor % 50 !== 0) {
    if (cursor !== undefined) {
      throw new ResourceNotFoundError(uri.href, `Invalid Relay resource cursor in ${uri.href}`);
    }
    return undefined;
  }
  return cursor / 50;
}

function continuationUri(uri: URL, cursor: string): string {
  const next = new URL(uri.href);
  next.searchParams.set("cursor", cursor);
  return next.href;
}

function outlineContinuationUri(uri: URL, page: number, cursor: string): string {
  const next = new URL(uri.href);
  if (next.pathname.endsWith("/outline")) next.pathname += `/${page}`;
  else next.pathname = next.pathname.replace(/\/\d+$/u, `/${page}`);
  next.searchParams.set("cursor", cursor);
  return next.href;
}

function paginationMetadata(
  uri: URL,
  resource: string,
  scope: RelayResourceScope,
  profile: RelayMcpProfile,
  offset: number,
  totalCount: number,
  returnedCount: number,
  nextBackendCursor?: string,
  currentBackendCursor?: string,
): Record<string, unknown> {
  const nextOffset = offset + returnedCount;
  const nextCursor =
    nextBackendCursor || nextOffset < totalCount
      ? encodeResourceCursor(resource, scope, profile, nextOffset, nextBackendCursor)
      : undefined;
  return {
    cursor:
      offset > 0
        ? encodeResourceCursor(resource, scope, profile, offset, currentBackendCursor)
        : undefined,
    pageSize: relayMcpResourcePageSize,
    totalCount,
    returnedCount,
    remainingCount: Math.max(0, totalCount - nextOffset),
    ...(nextCursor ? { nextCursor, nextResourceUri: continuationUri(uri, nextCursor) } : {}),
  };
}

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const localPath = /^(?:file:|\/(?:Users|private|var|tmp|home)\/|[A-Za-z]:[\\/])/i;
export function variable(
  variables: Variables,
  name: string,
  uri: URL,
  options: { allowCursor?: boolean } = {},
): string {
  const value = variables[name];
  if (typeof value !== "string" || !safeIdentifier.test(value)) {
    throw new ResourceNotFoundError(uri.href, `Unsafe Relay resource identifier in ${uri.href}`);
  }
  const queryKeys = [...uri.searchParams.keys()];
  if (
    uri.hash ||
    decodeURIComponent(uri.pathname).includes("..") ||
    (!options.allowCursor && uri.search) ||
    (options.allowCursor && queryKeys.some((key) => key !== "cursor")) ||
    (options.allowCursor && uri.searchParams.getAll("cursor").length > 1)
  ) {
    throw new ResourceNotFoundError(uri.href, `Unsafe Relay resource URI ${uri.href}`);
  }
  return value;
}

export async function invokeRead(
  invoker: OperationInvoker,
  operationId: OperationId,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await invoker.invoke(operationId, input, { signal });
  } catch {
    throw new ProtocolError(
      ProtocolErrorCode.InternalError,
      `Relay query ${operationId} could not be read`,
    );
  }
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function arrayField(value: unknown, field: string): unknown[] {
  const items = object(value)[field];
  return Array.isArray(items) ? items : [];
}

export function scalarFields(value: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object(value)).filter(([, item]) => !Array.isArray(item)),
  );
}

function destIdentityCollectionEntries(value: unknown): Record<string, string | undefined>[] {
  if (!Array.isArray(value)) return [];
  const frames = value.flatMap((entry) => {
    const rec = object(entry);
    const caption = typeof rec.caption === "string" ? rec.caption.slice(0, 160) : undefined;
    const relativeName =
      typeof rec.relativeName === "string"
        ? rec.relativeName.slice(0, 160)
        : typeof rec.path === "string"
          ? rec.path.slice(0, 160)
          : undefined;
    return relativeName || caption
      ? [{ path: relativeName ?? caption!, ...(caption ? { caption } : {}) }]
      : [];
  });
  const result: Record<string, string | undefined>[] = [];
  for (const frame of projectCaptureReviewDestIdentity([], [], frames)) {
    const relativeName = frame.path.slice(0, 160);
    if (
      relativeName.startsWith("/") ||
      relativeName.includes("\\") ||
      relativeName.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      if (frame.caption) result.push({ caption: frame.caption });
      continue;
    }
    result.push({ relativeName, ...(frame.caption ? { caption: frame.caption } : {}) });
  }
  return result;
}

function captureReviewCollectionEntries(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const hasLeftover = value.some((entry) => {
    const item = object(entry);
    const caption = item.caption;
    const phase = item.phase;
    return isCaptureReviewLeftoverCaption(
      typeof caption === "string" ? caption : undefined,
      typeof phase === "string" ? phase : undefined,
    );
  });
  const entries = value.flatMap((entry) => {
    const rec = object(entry);
    const caption = typeof rec.caption === "string" ? rec.caption.slice(0, 160) : undefined;
    const phase = typeof rec.phase === "string" ? rec.phase : undefined;
    if (isCaptureReviewLeftoverCaption(caption, phase)) return [];
    const relativeName =
      typeof rec.relativeName === "string"
        ? rec.relativeName.slice(0, 160)
        : typeof rec.framePath === "string"
          ? rec.framePath.slice(0, 160)
          : typeof rec.path === "string"
            ? rec.path.slice(0, 160)
            : undefined;
    if (
      relativeName &&
      (relativeName.startsWith("/") ||
        relativeName.includes("\\") ||
        relativeName.split("/").some((segment) => segment === "." || segment === ".."))
    ) {
      return caption || typeof rec.captureId === "string"
        ? [
            {
              ...(typeof rec.captureId === "string"
                ? { captureId: rec.captureId.slice(0, 200) }
                : {}),
              ...(caption ? { caption } : {}),
              ...(typeof rec.status === "string" ? { status: rec.status } : {}),
              ...(typeof rec.phase === "string" ? { phase: rec.phase } : {}),
              ...(typeof rec.policy === "string" ? { policy: rec.policy } : {}),
            },
          ]
        : [];
    }
    if (!relativeName && !caption && typeof rec.captureId !== "string") return [];
    // Parity with CLI/MCP run.get compact captureReview: plan-tier / fixture
    // display names are not live identity (real names or authfx:… stay).
    // Device-observed historical signed-out (iOS Lane) is also dropped.
    const rawConfiguration = object(rec.configuration);
    const { account: listedAccount, ...configurationRest } = rawConfiguration;
    const observed = object(rec.observed);
    const observedBase: CaptureReviewObservedSession | undefined =
      typeof observed.profileId === "string" ||
      typeof observed.laneId === "string" ||
      typeof observed.iosHardwareClass === "string" ||
      observed.sessionStore === "playwright-user-data" ||
      observed.sessionStore === "electron-partition"
        ? {
            ...(typeof observed.laneId === "string" ? { laneId: observed.laneId } : {}),
            ...(typeof observed.profileId === "string" ? { profileId: observed.profileId } : {}),
            ...(observed.sessionStore === "playwright-user-data" ||
            observed.sessionStore === "electron-partition"
              ? { sessionStore: observed.sessionStore }
              : {}),
            ...(observed.iosHardwareClass === "physical-ipad" ||
            observed.iosHardwareClass === "physical-iphone" ||
            observed.iosHardwareClass === "simulator" ||
            observed.iosHardwareClass === "unproven"
              ? { iosHardwareClass: observed.iosHardwareClass }
              : {}),
          }
        : undefined;
    const appName = typeof configurationRest.app === "string" ? configurationRest.app : undefined;
    const observedSession = observedBase
      ? enrichCaptureReviewObservedSession(observedBase, appName)
      : undefined;
    const account = liveCaptureReviewAccount(
      typeof listedAccount === "string" ? listedAccount : undefined,
      observedSession,
    );
    const configuration = {
      ...configurationRest,
      ...(account ? { account } : {}),
    };
    return [
      {
        ...(typeof rec.captureId === "string" ? { captureId: rec.captureId.slice(0, 200) } : {}),
        ...(caption ? { caption } : {}),
        ...(typeof rec.status === "string" ? { status: rec.status } : {}),
        // relativeName survives MCP sanitize; framePath / path keys are stripped.
        ...(relativeName ? { relativeName } : {}),
        ...(typeof rec.phase === "string" ? { phase: rec.phase } : {}),
        ...(typeof rec.policy === "string" ? { policy: rec.policy } : {}),
        ...(Object.keys(configuration).length ? { configuration } : {}),
        ...(observedSession && Object.keys(observedSession).length
          ? { observed: observedSession }
          : {}),
      },
    ];
  });
  if (!hasLeftover) return entries;
  /** Pre-listed captureReview without dest-phase used to keep before · Tap beside
   * leftover Transition (parity with destIdentityCollectionEntries). */
  const projected = entries.filter(
    (entry) =>
      !isCaptureReviewOpenerCaption(typeof entry.caption === "string" ? entry.caption : undefined),
  );
  return projected.length ? projected : entries;
}

function projectRunListDestIdentity(value: unknown): unknown {
  const record = object(value);
  if (!Array.isArray(record.runs)) return value;
  return {
    ...record,
    runs: record.runs.map((item) => {
      const run = object(item);
      if (!Array.isArray(run.destIdentity) && !Array.isArray(run.captureReview)) return item;
      const destIdentity = destIdentityCollectionEntries(run.destIdentity);
      const captureReview = captureReviewCollectionEntries(run.captureReview);
      const { destIdentity: _drop, captureReview: _listedReview, ...rest } = run;
      return {
        ...rest,
        ...(destIdentity.length ? { destIdentity } : {}),
        ...(captureReview.length ? { captureReview } : {}),
      };
    }),
  };
}
function boundedCollectionItem(value: unknown, kind: "app-map" | "run" | "session"): unknown {
  const item = object(value);
  if (kind === "app-map") {
    return {
      ...(typeof item.id === "string" ? { id: item.id } : {}),
      ...(typeof item.name === "string" ? { name: item.name.slice(0, 160) } : {}),
      ...(typeof item.description === "string"
        ? { description: item.description.slice(0, 240) }
        : {}),
      ...(typeof item.revision === "number" ? { revision: item.revision } : {}),
      ...(typeof item.createdAt === "number" ? { createdAt: item.createdAt } : {}),
      ...(typeof item.updatedAt === "number" ? { updatedAt: item.updatedAt } : {}),
      ...(item.counts && typeof item.counts === "object" ? { counts: item.counts } : {}),
    };
  }
  if (kind === "run") {
    const destIdentity = destIdentityCollectionEntries(item.destIdentity).slice(0, 8);
    // Paged runs use this path instead of projectRunListDestIdentity — keep
    // dest wait-for captureReview account/observed and drop leftover Close.
    const captureReview = captureReviewCollectionEntries(item.captureReview).slice(0, 8);
    return {
      ...(typeof item.id === "string" ? { id: item.id } : {}),
      ...(typeof item.action === "string" ? { action: item.action.slice(0, 160) } : {}),
      ...(typeof item.title === "string" ? { title: item.title.slice(0, 160) } : {}),
      ...(typeof item.status === "string" ? { status: item.status } : {}),
      ...(typeof item.outcome === "string" ? { outcome: item.outcome } : {}),
      ...(typeof item.writtenAt === "number" ? { writtenAt: item.writtenAt } : {}),
      ...(typeof item.updatedAt === "number" ? { updatedAt: item.updatedAt } : {}),
      ...(destIdentity.length ? { destIdentity } : {}),
      ...(captureReview.length ? { captureReview } : {}),
    };
  }
  return {
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    ...(typeof item.appMapId === "string" ? { appMapId: item.appMapId } : {}),
    ...(typeof item.state === "string" ? { state: item.state } : {}),
    ...(typeof item.updatedAt === "number" ? { updatedAt: item.updatedAt } : {}),
    ...(item.target && typeof item.target === "object" ? { target: item.target } : {}),
  };
}

export function paginatedCollection(
  value: unknown,
  field: string,
  resource: string,
  uri: URL,
  scope: RelayResourceScope,
  profile: RelayMcpProfile,
  kind: "app-map" | "run" | "session",
): Record<string, unknown> {
  const source = arrayField(value, field);
  const cursor = cursorForUri(uri, resource, scope, profile);
  if (cursor.backendCursor === undefined && cursor.offset > source.length) {
    throw new ResourceNotFoundError(uri.href, `Stale Relay resource cursor in ${uri.href}`);
  }
  const backendPage = cursor.backendCursor !== undefined;
  const page = backendPage
    ? source.slice(0, relayMcpResourcePageSize)
    : source.slice(cursor.offset, cursor.offset + relayMcpResourcePageSize);
  const backendCursor =
    typeof object(value).nextCursor === "string" ? (object(value).nextCursor as string) : undefined;
  const reportedTotal = object(value).totalCount;
  const totalCount =
    typeof reportedTotal === "number" && Number.isSafeInteger(reportedTotal)
      ? reportedTotal
      : backendPage
        ? cursor.offset + source.length + (backendCursor ? 1 : 0)
        : source.length;
  return {
    ...Object.fromEntries(
      Object.entries(scalarFields(value)).filter(
        ([key]) => key !== "nextCursor" && key !== "totalCount",
      ),
    ),
    [field]: page.map((item) => boundedCollectionItem(item, kind)),
    pagination: paginationMetadata(
      uri,
      resource,
      scope,
      profile,
      cursor.offset,
      totalCount,
      page.length,
      backendCursor,
      cursor.backendCursor,
    ),
  };
}

export function evidencePage(
  value: unknown,
  uri: URL,
  scope: RelayResourceScope,
  profile: RelayMcpProfile,
): Record<string, unknown> {
  const input = object(value);
  const arrays = Object.entries(input).filter(([, item]) => Array.isArray(item));
  const entries = arrays.flatMap(([field, items]) =>
    (items as unknown[]).map((item) => ({ field, item })),
  );
  const cursor = cursorForUri(uri, "run-evidence", scope, profile);
  const page = entries.slice(cursor.offset, cursor.offset + relayMcpResourcePageSize);
  const byField = new Map<string, unknown[]>();
  for (const entry of page) {
    const field = byField.get(entry.field) ?? [];
    field.push(entry.item);
    byField.set(entry.field, field);
  }
  return {
    ...Object.fromEntries(
      Object.entries(input).filter(
        ([field, item]) => !Array.isArray(item) && field !== "pagination",
      ),
    ),
    ...Object.fromEntries(byField),
    pagination: paginationMetadata(
      uri,
      "run-evidence",
      scope,
      profile,
      cursor.offset,
      entries.length,
      page.length,
    ),
  };
}

export function testCollection(value: unknown): {
  map: Record<string, unknown>;
  tests: Record<string, unknown>;
} {
  const map = object(object(value).appMap);
  return { map, tests: object(map.tests) };
}

export function testSummary(value: unknown): Record<string, unknown> {
  const test = object(value);
  const steps = Array.isArray(test.steps) ? test.steps : [];
  return {
    id: test.id,
    name:
      typeof test.name === "string" && test.name.length > 160
        ? `${test.name.slice(0, 157)}…`
        : test.name,
    kind: test.kind,
    ...(test.capture ? { capture: test.capture } : {}),
    intentSchemaVersion: test.intentSchemaVersion,
    rootStepCount: steps.length,
    updatedAt: test.updatedAt,
  };
}

type TestOutlineEntry = {
  id: unknown;
  kind: unknown;
  intent: unknown;
  parentStepId?: string;
  branch: "root" | "then" | "else" | "steps";
  index: number;
  binding: {
    status: unknown;
    kind?: unknown;
    reason?: string;
    referencedEntityIds?: string[];
  };
  childCounts?: { thenSteps?: number; elseSteps?: number; steps?: number };
};

export function testOutline(
  testValue: unknown,
  page = 0,
  uri?: URL,
  scope?: RelayResourceScope,
  profile?: RelayMcpProfile,
): Record<string, unknown> {
  const test = object(testValue);
  const entries: TestOutlineEntry[] = [];
  const visit = (
    stepsValue: unknown,
    branch: TestOutlineEntry["branch"],
    parentStepId?: string,
  ) => {
    const steps = Array.isArray(stepsValue) ? stepsValue : [];
    steps.forEach((stepValue, index) => {
      const step = object(stepValue);
      const binding = object(step.binding);
      const references = [
        ...(Array.isArray(binding.connectionIds) ? binding.connectionIds : []),
        ...(Array.isArray(binding.candidates)
          ? binding.candidates.map((candidate) => object(candidate).id)
          : []),
        binding.routineId,
        object(binding.assertion).screenId,
      ].filter((value): value is string => typeof value === "string");
      const id = typeof step.id === "string" ? step.id : undefined;
      entries.push({
        id: step.id,
        kind: step.kind,
        intent:
          typeof step.intent === "string" && step.intent.length > 80
            ? `${step.intent.slice(0, 77)}…`
            : step.intent,
        ...(parentStepId ? { parentStepId } : {}),
        branch,
        index,
        binding: {
          status: binding.status,
          ...(binding.kind ? { kind: binding.kind } : {}),
          ...(typeof binding.reason === "string"
            ? {
                reason:
                  binding.reason.length > 160 ? `${binding.reason.slice(0, 157)}…` : binding.reason,
              }
            : {}),
          ...(references.length ? { referencedEntityIds: references } : {}),
        },
        ...(step.kind === "decision"
          ? {
              childCounts: {
                thenSteps: Array.isArray(step.thenSteps) ? step.thenSteps.length : 0,
                elseSteps: Array.isArray(step.elseSteps) ? step.elseSteps.length : 0,
              },
            }
          : step.kind === "loop"
            ? { childCounts: { steps: Array.isArray(step.steps) ? step.steps.length : 0 } }
            : {}),
      });
      if (!id) return;
      if (step.kind === "decision") {
        visit(step.thenSteps, "then", id);
        visit(step.elseSteps, "else", id);
      } else if (step.kind === "loop") visit(step.steps, "steps", id);
    });
  };
  visit(test.steps, "root");
  const offset = page * 50;
  const returnedStepCount = Math.max(0, Math.min(entries.length - offset, 50));
  const remainingStepCount = Math.max(0, entries.length - offset - 50);
  const nextPage = remainingStepCount > 0 ? page + 1 : undefined;
  const nextCursor =
    nextPage !== undefined && uri && scope && profile
      ? encodeResourceCursor("test-outline", scope, profile, nextPage * 50)
      : undefined;
  return {
    test: testSummary(test),
    stepCount: entries.length,
    unresolvedCount: entries.filter(({ binding }) => binding.status === "unresolved").length,
    page,
    pageSize: 50,
    returnedStepCount,
    remainingStepCount,
    ...(nextPage !== undefined ? { nextPage } : {}),
    ...(nextCursor && uri
      ? {
          nextCursor,
          nextResourceUri: outlineContinuationUri(uri, nextPage!, nextCursor),
        }
      : {}),
    steps: entries.slice(offset, offset + 50),
  };
}

export function resourceList(
  items: unknown[],
  idField: string,
  titleField: string,
  uri: (id: string) => string,
  continuation?: {
    uri: string;
    resource: string;
    scope: RelayResourceScope;
    profile: RelayMcpProfile;
    backendCursor?: string;
  },
): { resources: Array<{ uri: string; name: string; mimeType: string }> } {
  const candidates = items
    .map(object)
    .filter((item) => typeof item[idField] === "string" && safeIdentifier.test(item[idField]));
  const resources = candidates.slice(0, relayMcpResourcePageSize).map((item) => {
    const id = item[idField] as string;
    const rawName =
      typeof item[titleField] === "string" && item[titleField] ? (item[titleField] as string) : id;
    const name = localPath.test(rawName) ? id : rawName.slice(0, 120);
    return { uri: uri(id), name, mimeType: relayMcpResourceMimeType };
  });
  if (
    continuation &&
    (candidates.length > relayMcpResourcePageSize || continuation.backendCursor !== undefined)
  ) {
    const cursor = encodeResourceCursor(
      continuation.resource,
      continuation.scope,
      continuation.profile,
      relayMcpResourcePageSize,
      continuation.backendCursor,
    );
    resources.push({
      uri: continuationUri(new URL(continuation.uri), cursor),
      name: `Next ${continuation.resource} page`,
      mimeType: relayMcpResourceMimeType,
    });
  }
  return { resources };
}

export async function targetLists(invoker: OperationInvoker, signal: AbortSignal) {
  const [devices, managed] = await Promise.all([
    invokeRead(invoker, "target.devices.list", {}, signal),
    invokeRead(invoker, "target.list", {}, signal),
  ]);
  return {
    devices: arrayField(devices, "devices"),
    managedTargets: arrayField(managed, "targets"),
  };
}

export function latestObservation(
  sessionsValue: unknown,
  targetId: string,
): Record<string, unknown> | null {
  const sessions = arrayField(sessionsValue, "sessions")
    .map(object)
    .filter((session) => object(session.target).targetId === targetId)
    .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0));
  const session = sessions[0];
  if (!session) return null;
  const take = object(session.take);
  const currentRevision = Number(take.currentRevision ?? 0);
  const revision = (Array.isArray(take.revisions) ? take.revisions : [])
    .map(object)
    .find((candidate) => candidate.revision === currentRevision);
  const observation = revision ? object(revision.after ?? revision.before) : {};
  return {
    sessionId: session.id,
    sessionState: session.state,
    updatedAt: session.updatedAt,
    takeId: take.id,
    takeRevision: currentRevision || undefined,
    observation: Object.keys(observation).length
      ? {
          id: observation.id,
          capturedAt: observation.capturedAt,
          bounds: observation.bounds,
          screen: observation.screen,
        }
      : null,
  };
}

export function registerStaticResource(
  server: McpServer,
  name: string,
  title: string,
  uri: string,
  read: (signal: AbortSignal, requestedUri: URL) => Promise<unknown>,
  scope: RelayResourceScope,
  profile: RelayMcpProfile,
  tools: readonly RelayMcpToolDescriptor[],
  requiredOperations: readonly OperationId[] = [],
): void {
  if (!resourceAllowed(profile, tools, requiredOperations)) return;
  const collection =
    name === "app-maps"
      ? { field: "appMaps", kind: "app-map" as const, resource: "app-maps" }
      : name === "runs"
        ? { field: "runs", kind: "run" as const, resource: "runs" }
        : name === "authoring-sessions"
          ? { field: "sessions", kind: "session" as const, resource: "authoring-sessions" }
          : undefined;
  const config = {
    title,
    description: `${title} in the configured Relay project.`,
    mimeType: relayMcpResourceMimeType,
  };
  const readCallback = async (requestedUri: URL, signal: AbortSignal) => {
    if (collection) cursorForUri(requestedUri, collection.resource, scope, profile);
    const value = await read(signal, requestedUri);
    if (!collection) return readResult(requestedUri, scope.projectId, name, value);
    const page = paginatedCollection(
      value,
      collection.field,
      collection.resource,
      requestedUri,
      scope,
      profile,
      collection.kind,
    );
    const sourceCount = arrayField(value, collection.field).length;
    const hasBackendContinuation =
      typeof object(value).nextCursor === "string" ||
      (typeof object(value).totalCount === "number" &&
        Number(object(value).totalCount) > sourceCount);
    const isPaged =
      sourceCount > relayMcpResourcePageSize ||
      requestedUri.searchParams.has("cursor") ||
      hasBackendContinuation;
    const projected = collection.kind === "run" ? projectRunListDestIdentity(value) : value;
    return readResult(requestedUri, scope.projectId, name, isPaged ? page : projected, page);
  };
  server.registerResource(name, uri, config, async (requestedUri, context) =>
    readCallback(requestedUri, context.mcpReq.signal),
  );
  if (collection) {
    server.registerResource(
      `${name}-page`,
      new ResourceTemplate(`${uri}{?cursor}`, { list: undefined }),
      config,
      async (requestedUri, _variables, context) =>
        readCallback(requestedUri, context.mcpReq.signal),
    );
  }
}

/** Every profile reads Apps, Tests, Runs and evidence (qa and device through
 * named tools), so no resource is hidden by profile. */
export function resourceAllowed(
  _profile: RelayMcpProfile,
  _tools: readonly RelayMcpToolDescriptor[],
  _requiredOperations: readonly OperationId[],
): boolean {
  return true;
}

export function templateResourceAllowed(
  profile: RelayMcpProfile,
  tools: readonly RelayMcpToolDescriptor[],
  requiredOperations: readonly OperationId[],
): boolean {
  return resourceAllowed(profile, tools, requiredOperations);
}
