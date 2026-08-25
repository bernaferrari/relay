import type { AppMapOperationMap } from "./app-map-operation-map.js";
import type { AppMapParserDependencies } from "./app-map-operation-parsers.js";

type Input<Id extends keyof AppMapOperationMap> = AppMapOperationMap[Id]["input"];
type Output<Id extends keyof AppMapOperationMap> = AppMapOperationMap[Id]["output"];

/** Kept beside the routine-impact contract so the broad App Map parser stays
 * a registry rather than becoming a second impact implementation. */
export function createAppMapImpactParsers(dependencies: AppMapParserDependencies) {
  const { fail, objectParser, record, string, number } = dependencies;
  const appMapRoutineImpactInputParser = objectParser<Input<"app-map.routine.impact">>(
    "routine impact preview",
    (input) => {
      string(input.appMapId, "routine impact appMapId");
      string(input.routineId, "routine impact routineId");
    },
  );
  const appMapRoutineImpactOutputParser = objectParser<Output<"app-map.routine.impact">>(
    "routine impact response",
    (output) => {
      const impact = record(output.impact, "routine impact response impact");
      string(impact.routineId, "routine impact routineId");
      if (!Array.isArray(impact.directUsages)) {
        fail("routine impact directUsages", "must be an array");
      }
      for (const usage of impact.directUsages as unknown[]) {
        const entry = record(usage, "routine impact directUsage");
        if (entry.ownerKind !== "connection" && entry.ownerKind !== "routine" && entry.ownerKind !== "flow") {
          fail("routine impact ownerKind", "must be connection, routine, or flow");
        }
        string(entry.ownerId, "routine impact ownerId");
      }
      for (const field of ["affectedRoutineIds", "affectedConnectionIds", "affectedFlowIds"] as const) {
        const ids = impact[field];
        if (!Array.isArray(ids)) fail(`routine impact ${field}`, "must be an array");
        for (const id of ids as unknown[]) string(id, `routine impact ${field} id`);
      }
    },
  );
  const appMapDiffImpactInputParser = objectParser<Input<"app-map.diff.impact">>(
    "diff impact query",
    (input) => {
      string(input.appMapId, "diff impact appMapId");
      if (!Array.isArray(input.changedFiles) || input.changedFiles.length === 0) {
        fail("diff impact changedFiles", "must be a non-empty array");
      }
      for (const [index, file] of (input.changedFiles as unknown[]).entries()) {
        string(file, `diff impact changedFiles ${index}`);
      }
      if (input.sourcePaths !== undefined) {
        const mapping = record(input.sourcePaths, "diff impact sourcePaths");
        for (const [entityId, paths] of Object.entries(mapping)) {
          string(entityId, "diff impact sourcePaths entityId");
          if (!Array.isArray(paths)) fail("diff impact sourcePaths", "values must be arrays");
          for (const [index, path] of (paths as unknown[]).entries()) {
            string(path, `diff impact sourcePaths ${entityId} ${index}`);
          }
        }
      }
    },
  );
  const appMapDiffImpactOutputParser = objectParser<Output<"app-map.diff.impact">>(
    "diff impact response",
    (output) => {
      number(output.appMapRevision, "diff impact response appMapRevision");
      string(output.appMapId, "diff impact response appMapId");
      if (!Array.isArray(output.changedFiles)) {
        fail("diff impact response changedFiles", "must be an array");
      }
      if (!Array.isArray(output.matchedEntityIds)) {
        fail("diff impact response matchedEntityIds", "must be an array");
      }
      if (!Array.isArray(output.affectedTestIds)) {
        fail("diff impact response affectedTestIds", "must be an array");
      }
      for (const id of output.changedFiles as unknown[]) string(id, "diff impact changedFile");
      for (const id of output.matchedEntityIds as unknown[]) {
        string(id, "diff impact matchedEntityId");
      }
      for (const id of output.affectedTestIds as unknown[]) {
        string(id, "diff impact affectedTestId");
      }
    },
  );
  return {
    appMapRoutineImpactInputParser,
    appMapRoutineImpactOutputParser,
    appMapDiffImpactInputParser,
    appMapDiffImpactOutputParser,
  };
}
