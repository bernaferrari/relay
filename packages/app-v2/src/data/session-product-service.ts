import { ApiError } from "@relay/client";
import type {
  ActivityRecord,
  AuthoringCaptureProvenance,
  AuthoringSession,
  AuthoringSessionState,
  AuthoringTarget,
  DeviceLease,
} from "@relay/protocol";
import { authoringCaptureProvenance } from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import type { LiveTargetSession } from "./live-target-session";

/** The public identity of a Session. Full authoring Takes and evidence remain
 * behind the explicit authoring-session operations. */
export type ProductSessionSummary = {
  id: string;
  title: string;
  state: AuthoringSessionState;
  target: AuthoringTarget;
  appMapId: string;
  actorId: string;
  actorKind: AuthoringSession["actorKind"];
  captureProvenance: AuthoringCaptureProvenance;
  createdAt: number;
  updatedAt: number;
  lease: ProductSessionLease | null;
  take?: ProductSessionTakeSummary;
  /** A failure is intentionally represented without copying platform
   * diagnostics into a list response. Inspecting the detail is explicit. */
  hasError: boolean;
  archived: boolean;
};

export type ProductSessionLease = Pick<
  DeviceLease,
  "id" | "projectId" | "poolId" | "deviceSerial" | "ownerId" | "status" | "leasedAt" | "expiresAt"
>;

export type ProductSessionTakeSummary = {
  id: string;
  state: NonNullable<AuthoringSession["take"]>["state"];
  revision: number;
  actionCount: number;
  evidenceCount: number;
  latestReplay?: {
    outcome: NonNullable<AuthoringSession["take"]>["replayAttempts"][number]["outcome"];
    takeRevision: number;
    durationMs: number;
  };
};

export type ProductSessionActivity = Pick<
  ActivityRecord,
  | "activityId"
  | "actorId"
  | "actorKind"
  | "operationId"
  | "requestId"
  | "timestamp"
  | "eventType"
  | "summary"
  | "outcome"
  | "durationMs"
  | "statusCode"
  | "errorCode"
  | "leaseId"
  | "sessionId"
>;

/** Detail adds only the context a Session workspace needs to reopen or end a
 * durable session. Action values, selectors, trees, and evidence bodies are
 * deliberately not projected here. */
export type ProductSessionDetail = ProductSessionSummary & {
  projectId: string;
  appName?: string;
  sourceScreenId?: string;
  testName?: string;
  committedConnectionId?: string;
  committedTestId?: string;
  error?: string;
  archive?: NonNullable<AuthoringSession["archive"]>;
  activity: readonly ProductSessionActivity[];
};

export type SessionListOptions = {
  appMapId?: string;
  targetId?: string;
  activeOnly?: boolean;
  includeHistory?: boolean;
};

export type SessionProductService = {
  list(options?: SessionListOptions): Promise<readonly ProductSessionSummary[]>;
  get(sessionId: string): Promise<ProductSessionDetail | undefined>;
  /** Capture a fresh target observation while preserving canonical state. */
  refresh(sessionId: string): Promise<ProductSessionDetail>;
  /** End maps to the server-owned cancellation transition. */
  end(sessionId: string): Promise<ProductSessionDetail>;
  /** Open the existing target stream/control adapter for a Session target. */
  live(sessionId: string): Promise<LiveTargetSession>;
};

export const sessionQueryKeys = {
  sessions: ["sessions"] as const,
  sessionLists: ["sessions", "list"] as const,
  sessionList: (options: SessionListOptions) => ["sessions", "list", options] as const,
  session: (sessionId: string) => ["sessions", sessionId] as const,
};

type SessionClient = Awaited<ReturnType<typeof productClientForPlatform>>["client"];

function boundedText(value: string | undefined, maxLength = 512): string | undefined {
  if (!value) return undefined;
  const normalized = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? "" : character;
    })
    .join("")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function titleForSession(session: AuthoringSession): string {
  return (
    boundedText(session.testName, 160) ?? boundedText(session.group, 160) ?? "Untitled Session"
  );
}

function leaseForSession(
  session: AuthoringSession,
  leases: readonly DeviceLease[],
): ProductSessionLease | null {
  const lease = leases.find(
    (candidate) =>
      candidate.id === session.leaseId &&
      candidate.projectId === session.projectId &&
      (candidate.organizationId === undefined ||
        candidate.organizationId === session.organizationId) &&
      candidate.deviceSerial === session.target.targetId &&
      candidate.ownerId === session.actorId,
  );
  if (!lease) return null;
  return {
    id: lease.id,
    projectId: lease.projectId,
    poolId: lease.poolId,
    deviceSerial: lease.deviceSerial,
    ownerId: lease.ownerId,
    status: lease.status,
    leasedAt: lease.leasedAt,
    expiresAt: lease.expiresAt,
  };
}

function takeForSession(session: AuthoringSession): ProductSessionTakeSummary | undefined {
  const take = session.take;
  if (!take) return undefined;
  const revision = take.revisions.find((candidate) => candidate.revision === take.currentRevision);
  const replay = take.replayAttempts
    .filter((candidate) => candidate.takeRevision === take.currentRevision)
    .at(-1);
  return {
    id: take.id,
    state: take.state,
    revision: take.currentRevision,
    actionCount: revision?.actions.length ?? 0,
    evidenceCount: revision?.evidence.length ?? 0,
    ...(replay
      ? {
          latestReplay: {
            outcome: replay.outcome,
            takeRevision: replay.takeRevision,
            durationMs: Math.max(0, replay.finishedAt - replay.startedAt),
          },
        }
      : {}),
  };
}

function projectActivity(activity: ActivityRecord): ProductSessionActivity {
  return {
    activityId: activity.activityId,
    actorId: activity.actorId,
    actorKind: activity.actorKind,
    operationId: activity.operationId,
    requestId: activity.requestId,
    timestamp: activity.timestamp,
    eventType: activity.eventType,
    summary: boundedText(activity.summary, 240) ?? "Session activity",
    ...(activity.outcome ? { outcome: activity.outcome } : {}),
    ...(activity.durationMs !== undefined ? { durationMs: activity.durationMs } : {}),
    ...(activity.statusCode !== undefined ? { statusCode: activity.statusCode } : {}),
    ...(activity.errorCode ? { errorCode: activity.errorCode } : {}),
    ...(activity.leaseId ? { leaseId: activity.leaseId } : {}),
    ...(activity.sessionId ? { sessionId: activity.sessionId } : {}),
  };
}

function sessionActivity(
  sessionId: string,
  records: readonly ActivityRecord[],
): readonly ProductSessionActivity[] {
  return records
    .filter(
      (record) =>
        record.sessionId === sessionId ||
        (record.resourceKind === "recording-session" && record.resourceId === sessionId),
    )
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(projectActivity);
}

export function projectSessionSummary(
  session: AuthoringSession,
  leases: readonly DeviceLease[] = [],
): ProductSessionSummary {
  const takeSummary = takeForSession(session);
  return {
    id: session.id,
    title: titleForSession(session),
    state: session.state,
    target: structuredClone(session.target),
    appMapId: session.appMapId,
    actorId: session.actorId,
    actorKind: session.actorKind,
    captureProvenance: authoringCaptureProvenance(session.captureProvenance),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lease: leaseForSession(session, leases),
    ...(takeSummary ? { take: takeSummary } : {}),
    hasError: Boolean(session.error),
    archived: Boolean(session.archive),
  };
}

export function projectSessionDetail(
  session: AuthoringSession,
  leases: readonly DeviceLease[],
  records: readonly ActivityRecord[],
  appName?: string,
): ProductSessionDetail {
  return {
    ...projectSessionSummary(session, leases),
    projectId: session.projectId,
    ...(appName ? { appName } : {}),
    ...(session.sourceScreenId ? { sourceScreenId: session.sourceScreenId } : {}),
    ...(boundedText(session.testName, 160) ? { testName: boundedText(session.testName, 160) } : {}),
    ...(session.committedConnectionId
      ? { committedConnectionId: session.committedConnectionId }
      : {}),
    ...(session.committedTestId ? { committedTestId: session.committedTestId } : {}),
    ...(boundedText(session.error) ? { error: boundedText(session.error) } : {}),
    ...(session.archive ? { archive: structuredClone(session.archive) } : {}),
    activity: sessionActivity(session.id, records),
  };
}

async function leases(client: SessionClient): Promise<readonly DeviceLease[]> {
  const result = await client.invoke("lease.list", { status: "all" });
  return result.leases;
}

async function activities(client: SessionClient): Promise<readonly ActivityRecord[]> {
  try {
    const result = await client.invoke("activity.list", { limit: 100 });
    // Older Relay servers expose the core page as `items`; newer operation
    // schemas call the same bounded collection `records`.
    const value = result as unknown as { records?: ActivityRecord[]; items?: ActivityRecord[] };
    return value.records ?? value.items ?? [];
  } catch (error) {
    // Relay servers that predate the operation schema used `items` for this
    // same page. Preserve that read compatibility at this product seam while
    // still treating all activity as optional audit context.
    if (error instanceof ApiError && error.status === 502) {
      const body = error.body;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const items = (body as { items?: unknown }).items;
        if (Array.isArray(items)) return items as ActivityRecord[];
      }
    }
    // Activity is audit context and may be unavailable to a non-admin actor;
    // the durable Session itself remains inspectable.
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return [];
    throw error;
  }
}

async function detail(
  client: SessionClient,
  session: AuthoringSession,
): Promise<ProductSessionDetail> {
  const [leaseRecords, activityRecords, appName] = await Promise.all([
    leases(client),
    activities(client),
    client
      .invoke("app-map.get", { appMapId: session.appMapId })
      .then(({ appMap }) => boundedText(appMap.name, 160))
      .catch(() => undefined),
  ]);
  return projectSessionDetail(session, leaseRecords, activityRecords, appName);
}

export function createSessionProductService(platform: Platform): SessionProductService {
  let clientPromise: ReturnType<typeof productClientForPlatform> | undefined;
  const client = () =>
    (clientPromise ??= productClientForPlatform(platform)).then(({ client }) => client);
  return {
    async list(options = {}) {
      const [sessionResult, leaseRecords] = await Promise.all([
        (await client()).invoke("authoring.session.list", options),
        leases(await client()),
      ]);
      return sessionResult.sessions.map((session) => projectSessionSummary(session, leaseRecords));
    },
    async get(sessionId) {
      try {
        const relayClient = await client();
        const result = await relayClient.invoke("authoring.session.get", { sessionId });
        return detail(relayClient, result.session);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return undefined;
        throw error;
      }
    },
    async refresh(sessionId) {
      const relayClient = await client();
      const result = await relayClient.invoke(
        "authoring.session.observe",
        { sessionId },
        {
          authoringSessionId: sessionId,
        },
      );
      return detail(relayClient, result.session);
    },
    async end(sessionId) {
      const relayClient = await client();
      const result = await relayClient.invoke(
        "authoring.session.cancel",
        { sessionId },
        {
          authoringSessionId: sessionId,
        },
      );
      return detail(relayClient, result.session);
    },
    async live(sessionId) {
      const relayClient = await client();
      const result = await relayClient.invoke("authoring.session.get", { sessionId });
      const { createLiveTargetSession } = await import("./live-target-session");
      const opened = result.session as {
        target: typeof result.session.target;
        authenticationFixtureId?: string;
        signedOut?: true;
        sessionId?: string;
      };
      return createLiveTargetSession({
        client: relayClient,
        target: opened.target,
        identity: {
          ...(opened.authenticationFixtureId
            ? { authenticationFixtureId: opened.authenticationFixtureId }
            : {}),
          ...(opened.signedOut ? { signedOut: true as const } : {}),
          ...(opened.sessionId ? { sessionId: opened.sessionId } : {}),
        },
      });
    },
  };
}
