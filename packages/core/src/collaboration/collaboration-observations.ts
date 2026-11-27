import type { AppMap } from "@relay/protocol";
import { validateAppMap } from "../app-map/app-map.js";
import { appMapKey } from "./collaboration-app-map-key.js";
import { withControlStore, type ControlStore } from "./collaboration-store.js";

/**
 * Write derived runtime observations (replay hit counters) into the document
 * without advancing its revision, touching updatedAt, or emitting an event.
 * The revision is the user-visible "the test changed" signal: editors rebase
 * against it, validation receipts freeze it, and every bump clears redo
 * history. Usage telemetry is not a change a person made, so it must not
 * travel that path. The tradeoff: because the revision does not advance, a
 * concurrent revisioned mutation that already read the map can overwrite the
 * observation — counters are best-effort telemetry, never user-authored
 * content. Returns undefined when the map is missing or the observer has
 * nothing to write.
 */
export async function writeStoredAppMapObservation(
  projectId: string,
  appMapId: string,
  observe: (current: AppMap, store: ControlStore) => AppMap | undefined,
): Promise<AppMap | undefined> {
  return withControlStore((store) => {
    const key = appMapKey(projectId, appMapId);
    const current = store.appMap(key);
    if (!current) return undefined;
    const validatedCurrent = validateAppMap(current);
    const observed = observe(validatedCurrent, store);
    if (!observed) return undefined;
    const next = validateAppMap(observed);
    if (
      next.id !== appMapId ||
      next.projectId !== projectId ||
      next.organizationId !== validatedCurrent.organizationId
    ) {
      throw new Error("App Map observation changed its scope");
    }
    if (
      next.revision !== validatedCurrent.revision ||
      next.updatedAt !== validatedCurrent.updatedAt
    ) {
      throw new Error("App Map observation must not advance revision semantics");
    }
    store.upsertAppMap(key, next);
    return next;
  });
}
