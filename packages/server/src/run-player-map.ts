import {
  PLAYER_MAP_SNAPSHOT_ARTIFACT_KIND,
  playerMapSnapshotFromRun,
  readAppMap,
  snapshotPlayerMap,
  type PersistedRun,
  type PlayerMapSnapshot,
} from "@relay/core";
import { HttpError } from "./http.js";

function plannedRevision(run: PersistedRun): number | undefined {
  const data = run.artifacts?.find((artifact) => artifact.kind === "app-map-test-plan")?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const revision = (data as { appMapRevision?: unknown }).appMapRevision;
  return typeof revision === "number" && Number.isSafeInteger(revision) ? revision : undefined;
}

/** Preserve the authored structure a Run saw. Legacy runs can only use a Map
 * that has not advanced beyond their compiled revision. */
export async function playerMapForRuns(input: {
  projectId: string;
  appMapId: string;
  runs: readonly PersistedRun[];
}): Promise<PlayerMapSnapshot> {
  const snapshots = input.runs.map((run) => {
    const frozen = playerMapSnapshotFromRun(run);
    if (
      !frozen &&
      run.artifacts?.some((artifact) => artifact.kind === PLAYER_MAP_SNAPSHOT_ARTIFACT_KIND)
    ) {
      throw new HttpError(409, `Run ${run.id} has an invalid player snapshot`);
    }
    if (frozen && frozen.id !== input.appMapId) {
      throw new HttpError(409, `Run ${run.id} has a player snapshot for another App Map`);
    }
    const planned = plannedRevision(run);
    if (frozen && planned !== undefined && frozen.revision !== planned) {
      throw new HttpError(409, `Run ${run.id} has conflicting Map revisions`);
    }
    return frozen;
  });
  const frozen = snapshots.find((snapshot): snapshot is PlayerMapSnapshot => Boolean(snapshot));
  if (frozen) {
    for (const [index, snapshot] of snapshots.entries()) {
      if (!snapshot || snapshot.revision !== frozen.revision) {
        throw new HttpError(
          409,
          `Run ${input.runs[index]!.id} cannot be joined with a different player snapshot`,
        );
      }
    }
    return frozen;
  }

  const map = await readAppMap(input.projectId, input.appMapId);
  if (!map) throw new HttpError(404, `App Map ${input.appMapId} not found`);
  for (const run of input.runs) {
    const planned = plannedRevision(run);
    if (planned !== undefined && planned !== map.revision) {
      throw new HttpError(
        409,
        `Run ${run.id} predates the current App Map and has no frozen player snapshot`,
      );
    }
  }
  return snapshotPlayerMap(map);
}
