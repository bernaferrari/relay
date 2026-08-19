import { commitAppMapChanges } from "./app-map.js";
import { discoveryLandChanges } from "./app-map/observation-proposal.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { readDiscoverySession } from "./discovery.js";
import { currentOperationContext } from "./operation-context.js";

/** File observed screens/edges onto the App Map. Called from a human or agent tap. */
export async function landDiscoveryOnAppMap(
  sessionId: string,
  transitionId?: string,
): Promise<void> {
  const latest = await readDiscoverySession(sessionId);
  if (!latest) return;
  const appMapId = latest.agent?.appMapId;
  if (!appMapId) return;
  const map = await readAppMap(latest.projectId ?? "default", appMapId);
  if (!map) return;
  const changes = discoveryLandChanges({
    map,
    session: latest,
    ...(transitionId ? { transitionId } : {}),
  });
  if (!changes.length) return;
  const operation = currentOperationContext();
  await mutateStoredAppMap(map.projectId, map.id, (current) =>
    commitAppMapChanges(
      current,
      changes,
      undefined,
      {
        expectedRevision: current.revision,
        eventId: `land-${latest.id}-${transitionId ?? "root"}`.slice(0, 128),
        actorId: operation?.actorId ?? "agent:explore",
        actorKind: operation?.actorKind ?? "agent",
        at: Math.max(Date.now(), current.updatedAt),
      },
      latest.screens.find((screen) => screen.id === latest.currentScreenId)?.title ||
        "Mapped a screen",
    ),
  );
}
