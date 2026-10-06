import { frozenRunScreenContext, type JourneyJob } from "./run-screen-journey-plan";
export { matchRunScreenIdentity } from "./run-screen-journey-plan";
type RecordValue = Record<string, unknown>;
export type RunScreenFact = "planned" | "reached-check" | "observed";
export type RunScreenWaypoint = {
  id: string;
  screenId: string;
  title: string;
  state: "pending" | "visited" | "current";
  fact: RunScreenFact;
  via?: { connectionId: string; label: string };
  traceStepId?: string;
};
export type RunScreenVisit = {
  screenId: string;
  title: string;
  at?: number;
  branch: boolean;
  fromScreenId?: string;
  /** Planned occurrence lineage; screen IDs may recur along a path. */
  waypointId?: string;
  fromWaypointId?: string;
};
export type RunScreenCurrent =
  | {
      status: "proven";
      screenId: string;
      title: string;
      fact: "reached-check" | "observed";
      at?: number;
    }
  | { status: "unknown" | "external-handoff"; reason?: string; foregroundApp?: string };
export type RunScreenJourney = {
  planned: RunScreenWaypoint[];
  observed: RunScreenVisit[];
  current?: RunScreenCurrent;
};

const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined;
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const time = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
/** Project retained evidence only. Trace titles and expected titles never establish screen identity. */
export function buildRunScreenJourney(job: JourneyJob): RunScreenJourney {
  const { artifacts, snapshot, checkpoints, screens } = frozenRunScreenContext(job);
  const planned: RunScreenWaypoint[] = [];
  const traces = array(job.steps).map(record);
  for (const { step, recipeId, dependencies } of checkpoints) {
    const screenId = text(step.screenId);
    if (!screenId) continue;
    const last = planned.at(-1);
    const waypoint =
      last?.screenId === screenId
        ? last
        : {
            id: `${recipeId ?? "recipe"}:${text(step.id) ?? planned.length}`,
            screenId,
            title: screens.get(screenId)?.title ?? screenId,
            state: "pending" as const,
            fact: "planned" as RunScreenFact,
          };
    if (waypoint !== last) planned.push(waypoint);
    const dependency = dependencies
      .map(record)
      .find((d) => record(d?.destination)?.screenId === screenId && d?.originScreenId !== screenId);
    const connectionId = text(dependency?.connectionId);
    const connection = connectionId
      ? record(record(snapshot?.connections)?.[connectionId])
      : undefined;
    const label = text(connection?.label);
    if (connectionId && label && !waypoint.via) waypoint.via = { connectionId, label };
    const matching = traces.filter(
      (trace) =>
        recipeId && text(step.id) && trace?.recipeId === recipeId && trace.recipeStepId === step.id,
    );
    // Repeated invocation provenance is ambiguous without occurrence lineage.
    if (matching.length === 1 && matching[0]?.status === "ok") {
      waypoint.state = "visited";
      waypoint.fact = "reached-check";
      waypoint.traceStepId = text(matching[0].id);
    }
  }
  const observed: RunScreenVisit[] = [];
  let current: RunScreenCurrent | undefined;
  let progress = -1;
  let currentIndex = -1;
  for (const artifact of artifacts) {
    if (artifact.kind !== "navigation-proof-cursor") continue;
    const cursor = record(artifact.data);
    if (cursor?.status === "unknown" || cursor?.status === "external-handoff") {
      current = {
        status: cursor.status,
        reason: text(cursor.reason),
        foregroundApp: text(cursor.foregroundApp),
      };
      currentIndex = -1;
      continue;
    }
    const screenId = text(cursor?.screenId);
    if (cursor?.status !== "proven" || !screenId || !text(cursor.proofToken)) continue;
    if (!["screen-observation", "transition", "cleanup"].includes(text(cursor.source) ?? ""))
      continue;
    const title = screens.get(screenId)?.title ?? screenId;
    const at = time(cursor.updatedAt) ?? time(artifact.capturedAt);
    const isObservation = cursor.source === "screen-observation";
    const matchedIndex = planned.findIndex((p, i) => i >= progress && p.screenId === screenId);
    const branch = matchedIndex < 0 || matchedIndex > progress + 1;
    currentIndex = branch ? -1 : matchedIndex;
    current = {
      status: "proven",
      screenId,
      title,
      fact: isObservation ? "observed" : "reached-check",
      at,
    };
    if (matchedIndex >= 0 && !branch) {
      progress = matchedIndex;
      planned[matchedIndex]!.state = "visited";
      if (isObservation) planned[matchedIndex]!.fact = "observed";
      else if (planned[matchedIndex]!.fact === "planned")
        planned[matchedIndex]!.fact = "reached-check";
    }
    if (isObservation) {
      const previous = observed.at(-1);
      const waypointId = branch ? undefined : planned[matchedIndex]?.id;
      if (
        previous?.screenId === screenId &&
        previous.branch === branch &&
        previous.waypointId === waypointId
      )
        previous.at = at;
      else
        observed.push({
          screenId,
          title,
          at,
          branch,
          fromScreenId: previous?.screenId,
          waypointId,
          fromWaypointId: previous?.waypointId,
        });
    }
  }
  if (currentIndex >= 0) planned[currentIndex]!.state = "current";
  return { planned, observed, current };
}
