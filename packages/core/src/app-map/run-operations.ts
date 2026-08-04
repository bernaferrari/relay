import type { TargetProfile } from "@relay/protocol";
import type { AppMap, AppMapMutationContext, TargetResultOutcome } from "./model.js";
import { appMapFail } from "./errors.js";
import { mutateAppMap } from "./mutation.js";

export type RecordAppMapRunInput = {
  runId: string;
  flowId: string;
  appMapRevision: number;
  targetProfile: TargetProfile;
  outcome: TargetResultOutcome;
  startedAt: number;
  finishedAt: number;
  connectionId?: string;
  evidenceIds: string[];
};

/** Persist one target execution in the same canonical document humans and
 * agents author. Reports remain the detailed evidence; this projection keeps
 * coverage, attribution, and map status queryable without parsing run files. */
export function recordAppMapRun(
  map: AppMap,
  input: RecordAppMapRunInput,
  context: AppMapMutationContext,
): AppMap {
  if (map.runs[input.runId]) appMapFail("duplicate-id", `Run ${input.runId} already exists`);
  if (!map.flows[input.flowId]) {
    appMapFail("missing-reference", `Flow ${input.flowId} does not exist`);
  }
  if (input.appMapRevision > map.revision) {
    appMapFail("missing-reference", `Run ${input.runId} references a future App Map revision`);
  }
  if (input.connectionId && !map.connections[input.connectionId]) {
    appMapFail("missing-reference", `Connection ${input.connectionId} does not exist`);
  }
  const targetResultId = `${input.runId}-target`;
  if (map.targetResults[targetResultId]) {
    appMapFail("duplicate-id", `Target result ${targetResultId} already exists`);
  }

  return mutateAppMap(
    map,
    context,
    {
      eventType: "run.finished",
      subject: { kind: "run", id: input.runId },
      summary: `${map.flows[input.flowId]!.name} ${input.outcome} on ${input.targetProfile.name}`,
    },
    (draft) => {
      const scope = {
        organizationId: draft.organizationId,
        projectId: draft.projectId,
        appMapId: draft.id,
      };
      draft.runs[input.runId] = {
        ...scope,
        id: input.runId,
        flowId: input.flowId,
        appMapRevision: input.appMapRevision,
        targetResultIds: [targetResultId],
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        createdAt: input.startedAt,
        updatedAt: context.at,
      };
      draft.targetResults[targetResultId] = {
        ...scope,
        id: targetResultId,
        runId: input.runId,
        targetProfile: structuredClone(input.targetProfile),
        outcome: input.outcome,
        ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        evidenceIds: [...input.evidenceIds],
        finishedAt: input.finishedAt,
        createdAt: input.startedAt,
        updatedAt: context.at,
      };
    },
  );
}
