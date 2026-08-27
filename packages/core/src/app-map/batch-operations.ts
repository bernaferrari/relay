import type { AppMap, AppMapBatchChange, AppMapMutationContext, AppMapPatch } from "./model.js";
import { dropConnection, patchConnection, putConnection } from "./connection-operations.js";
import { applyAppMapPatch, assertEntityScope } from "./entity-operations.js";
import { appMapFail } from "./errors.js";
import { dropMapGroup, putMapGroup } from "./group-operations.js";
import { mutateAppMap } from "./mutation.js";
import { removeAppMapNote, saveAppMapNote } from "./note-operations.js";
import { dropScreen, patchScreen, putScreen } from "./screen-operations.js";

/** Applies a complete human or agent authoring gesture as one revision. Every
 * change is validated against the same draft and the store only observes the
 * final valid App Map. */
export function commitAppMapChanges(
  map: AppMap,
  changes: readonly AppMapBatchChange[],
  patch: AppMapPatch | undefined,
  context: AppMapMutationContext,
  summary = "Updated App Map canvas",
): AppMap {
  if (!changes.length && !patch) return map;
  return mutateAppMap(
    map,
    context,
    {
      eventType: "app-map.committed",
      subject: { kind: "app-map", id: map.id },
      summary: summary.trim() || "Updated App Map canvas",
    },
    (draft) => {
      for (const change of changes) applyChange(draft, change, context.at);
      if (patch) applyAppMapPatch(draft, patch);
    },
  );
}

function applyChange(draft: AppMap, change: AppMapBatchChange, at: number): void {
  switch (change.kind) {
    case "note.save":
      saveAppMapNote(draft, change.note);
      return;
    case "note.remove":
      removeAppMapNote(draft, change.noteId);
      return;
    case "screen.add":
      putScreen(draft, change.input);
      return;
    case "screen.update":
      patchScreen(draft, change.screenId, change.input, at);
      return;
    case "screen.remove":
      dropScreen(draft, change.screenId, undefined, at);
      return;
    case "connection.create":
      putConnection(draft, change.connection);
      return;
    case "connection.update":
      patchConnection(draft, change.connectionId, change.patch, at);
      return;
    case "connection.remove":
      dropConnection(draft, change.connectionId);
      return;
    case "group.save":
      putMapGroup(draft, change.group);
      return;
    case "group.remove":
      dropMapGroup(draft, change.groupId);
      return;
    case "flow.save":
      assertEntityScope(draft, change.flow);
      draft.flows[change.flow.id] = structuredClone(change.flow);
      return;
    case "flow.remove":
      if (!draft.flows[change.flowId]) {
        appMapFail("missing-reference", `Flow ${change.flowId} does not exist`);
      }
      delete draft.flows[change.flowId];
      return;
    case "test.save":
      assertEntityScope(draft, change.test);
      draft.tests = { ...draft.tests, [change.test.id]: structuredClone(change.test) };
      return;
    case "combine.save":
      assertEntityScope(draft, change.combine);
      draft.combines = {
        ...draft.combines,
        [change.combine.id]: structuredClone(change.combine),
      };
      return;
    case "combine.remove": {
      if (!draft.combines[change.combineId]) {
        appMapFail("missing-reference", `Combine ${change.combineId} does not exist`);
      }
      const combines = { ...draft.combines };
      delete combines[change.combineId];
      draft.combines = combines;
      return;
    }
  }
}
