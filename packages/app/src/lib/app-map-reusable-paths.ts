import {
  APP_MAP_TEST_INTENT_SCHEMA_VERSION,
  type AppMap,
  type AppMapScenarioTest,
  type Connection,
  type Flow,
} from "@relay/protocol";

/**
 * A ready map recording that is not owned by a saved Flow yet.  A recording
 * proves a transition happened; this projection finds the unambiguous linear
 * sequences that can safely become a reusable path without inventing a route.
 */
export type RecordedPathCandidate = {
  id: string;
  name: string;
  startScreenId: string;
  /** Omitted only when the recorded route intentionally ends the app flow. */
  endScreenId?: string;
  connectionIds: string[];
  screenCount: number;
};

const SHA_256_FINGERPRINT = /^[a-f0-9]{64}$/u;

function compareConnections(left: Connection, right: Connection): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function displayScreenName(map: Pick<AppMap, "screens">, screenId: string): string {
  return map.screens[screenId]?.title?.trim() || "Untitled screen";
}

function candidateName(
  map: Pick<AppMap, "screens">,
  startScreenId: string,
  endScreenId: string | undefined,
): string {
  return `${displayScreenName(map, startScreenId)} → ${
    endScreenId ? displayScreenName(map, endScreenId) : "End"
  }`;
}

/** Stable browser-safe identity for a path. This is only an in-memory
 * candidate key; saved Flow/Test ids are allocated independently. */
function pathId(connectionIds: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const character of connectionIds.join("\u001f")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `recorded-${(hash >>> 0).toString(36)}`;
}

function destinationScreenId(connection: Connection): string | undefined {
  return connection.destination.kind === "screen" ? connection.destination.screenId : undefined;
}

function hasApprovedScreenIdentity(screen: AppMap["screens"][string] | undefined): boolean {
  const identity = screen?.identity;
  return Boolean(
    identity && identity.schemaVersion === 1 && SHA_256_FINGERPRINT.test(identity.fingerprint),
  );
}

/**
 * Candidate ids are deliberately just a compact UI affordance. Never use a
 * hash as authority for a recording: different connection sequences can have
 * the same 32-bit hash. The ordered ids are the durable, exact selection.
 */
export function sameRecordedPathConnectionIds(
  candidate: Pick<RecordedPathCandidate, "connectionIds">,
  connectionIds: readonly string[],
): boolean {
  return (
    candidate.connectionIds.length === connectionIds.length &&
    candidate.connectionIds.every((connectionId, index) => connectionId === connectionIds[index])
  );
}

/**
 * A candidate is safe to promote only if it has the same prerequisites as a
 * compiled Flow: a continuous chain of ready connections and a verified
 * identity at every screen the runner will expect. This stays portable to the
 * UI package while deliberately mirroring the compiler's screen guard.
 */
export function isRecordedPathCandidateRunnable(
  map: Pick<AppMap, "connections" | "screens">,
  candidate: Pick<RecordedPathCandidate, "startScreenId" | "endScreenId" | "connectionIds">,
): boolean {
  if (
    !candidate.connectionIds.length ||
    !hasApprovedScreenIdentity(map.screens[candidate.startScreenId])
  ) {
    return false;
  }

  let expectedSourceId = candidate.startScreenId;
  let terminalScreenId: string | undefined = expectedSourceId;
  for (let index = 0; index < candidate.connectionIds.length; index += 1) {
    const connection = map.connections[candidate.connectionIds[index]!];
    if (
      !connection ||
      connection.state !== "ready" ||
      connection.fromScreenId !== expectedSourceId
    ) {
      return false;
    }

    const destination = destinationScreenId(connection);
    if (!destination) {
      // A Flow cannot continue after its terminal end marker.
      if (index !== candidate.connectionIds.length - 1) return false;
      terminalScreenId = undefined;
      continue;
    }
    if (!hasApprovedScreenIdentity(map.screens[destination])) return false;
    expectedSourceId = destination;
    terminalScreenId = destination;
  }

  return candidate.endScreenId === terminalScreenId;
}

/**
 * Return the maximal deterministic segments of ready recordings that are not
 * already represented by a saved Flow. Branches deliberately become separate
 * candidates: choosing one is an explicit test-authoring decision, not an
 * arbitrary graph traversal.
 */
export function recordedPathCandidates(
  map: Pick<AppMap, "connections" | "flows" | "screens">,
): RecordedPathCandidate[] {
  const flowOwned = new Set(Object.values(map.flows).flatMap((flow) => flow.connectionIds));
  const available = Object.values(map.connections)
    .filter((connection) => connection.state === "ready" && !flowOwned.has(connection.id))
    .sort(compareConnections);
  if (!available.length) return [];

  const outgoing = new Map<string, Connection[]>();
  const incoming = new Map<string, number>();
  for (const connection of available) {
    const from = outgoing.get(connection.fromScreenId) ?? [];
    from.push(connection);
    outgoing.set(connection.fromScreenId, from);
    const destination = destinationScreenId(connection);
    if (destination) incoming.set(destination, (incoming.get(destination) ?? 0) + 1);
  }
  for (const values of outgoing.values()) values.sort(compareConnections);

  const used = new Set<string>();
  const candidates: RecordedPathCandidate[] = [];
  const appendPath = (first: Connection) => {
    if (used.has(first.id)) return;
    const connectionIds: string[] = [];
    const screenIds = new Set<string>([first.fromScreenId]);
    let current: Connection | undefined = first;
    while (current && !used.has(current.id)) {
      used.add(current.id);
      connectionIds.push(current.id);
      const destination = destinationScreenId(current);
      if (!destination) break;
      screenIds.add(destination);
      const next = outgoing.get(destination) ?? [];
      // Only continue through a node whose route is objectively linear. This
      // keeps divergent settings menus as separate deliberate test choices.
      current = incoming.get(destination) === 1 && next.length === 1 ? next[0] : undefined;
    }
    const last = connectionIds.at(-1);
    const terminal = last ? map.connections[last] : undefined;
    const endScreenId = terminal ? destinationScreenId(terminal) : undefined;
    const candidate: RecordedPathCandidate = {
      id: pathId(connectionIds),
      name: candidateName(map, first.fromScreenId, endScreenId),
      startScreenId: first.fromScreenId,
      ...(endScreenId ? { endScreenId } : {}),
      connectionIds,
      screenCount: screenIds.size,
    };
    if (isRecordedPathCandidateRunnable(map, candidate)) candidates.push(candidate);
  };

  // Every branch head (and every graph root) starts a path. Any remaining
  // edges belong to a closed loop, so emit one safe finite candidate for it.
  for (const connection of available) {
    const sourceOutgoing = outgoing.get(connection.fromScreenId) ?? [];
    if ((incoming.get(connection.fromScreenId) ?? 0) !== 1 || sourceOutgoing.length !== 1) {
      appendPath(connection);
    }
  }
  for (const connection of available) appendPath(connection);
  return candidates;
}

function uniqueId(
  prefix: string,
  seed: string,
  existing: Readonly<Record<string, unknown>>,
): string {
  const base = `${prefix}-${pathId([seed]).replace(/^recorded-/, "")}`;
  if (!existing[base]) return base;
  let index = 2;
  while (existing[`${base}-${index}`]) index += 1;
  return `${base}-${index}`;
}

function uniqueName(base: string, usedNames: Iterable<string>): string {
  const names = new Set([...usedNames].map((name) => name.trim().toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}

/** Build the two durable objects required by a run matrix from one explicit
 * recorded candidate. The Test binds the reviewed connections directly so new
 * authoring never creates the legacy read-only Path document. */
export function makeReusablePathFromRecording(
  map: Pick<
    AppMap,
    "id" | "organizationId" | "projectId" | "connections" | "flows" | "tests" | "screens"
  >,
  candidate: RecordedPathCandidate,
  at: number,
): { flow: Flow; test: AppMapScenarioTest } {
  if (!isRecordedPathCandidateRunnable(map, candidate)) {
    throw new Error("This recording cannot become a reusable path until every screen is verified");
  }
  const flowId = uniqueId("flow-recording", candidate.connectionIds.join("\u001f"), map.flows);
  const flowName = uniqueName(
    `Reusable path: ${candidate.name}`,
    Object.values(map.flows).map((flow) => flow.name),
  );
  const testId = uniqueId("test-recording", candidate.connectionIds.join("\u001f"), map.tests);
  const testName = uniqueName(
    candidate.name,
    Object.values(map.tests).map((test) => test.name),
  );
  const flow: Flow = {
    id: flowId,
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    name: flowName,
    startScreenId: candidate.startScreenId,
    connectionIds: [...candidate.connectionIds],
    createdAt: at,
    updatedAt: at,
  };
  const test: AppMapScenarioTest = {
    id: testId,
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    name: testName,
    kind: "scenario",
    intentSchemaVersion: APP_MAP_TEST_INTENT_SCHEMA_VERSION,
    steps: [
      {
        id: `${testId}-path`,
        kind: "instruction",
        intent: `Follow ${testName}`,
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: [...candidate.connectionIds],
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  return { flow, test };
}
