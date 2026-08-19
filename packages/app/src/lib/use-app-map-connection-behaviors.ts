import type { ActionSpec, AppMap } from "@relay/protocol";
import type { CanvasConnection } from "./app-map-connection-draft";
import { updateConnectionWait as updateConnectionWaitActions } from "./connection-action-presentation";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "./human-error";

export function useAppMapConnectionBehaviors(options: {
  activeAppMap: () => AppMap | undefined;
  canonicalConnectionFor: (
    connection: CanvasConnection,
  ) => AppMap["connections"][string] | undefined;
  onConnectionActionsChanged: (connectionId: string) => void;
}) {
  const server = useServer();

  const appendConnectionAction = async (
    connection: CanvasConnection,
    action: ActionSpec,
    confirmation: string,
  ) => {
    const map = options.activeAppMap();
    const canonical = options.canonicalConnectionFor(connection);
    if (!map || !canonical) {
      toast("This path is still syncing. Try again in a moment.", "info");
      return;
    }
    try {
      await server.runAction("app-map.connection.update", {
        appMapId: map.id,
        connectionId: canonical.id,
        expectedRevision: map.revision,
        patch: {
          state: "ready",
          actions: [...canonical.actions, action],
        },
      });
      await server.refreshAppMaps();
      options.onConnectionActionsChanged(connection.id);
      toast(confirmation, "success");
    } catch (error) {
      toast(humanError(error, "Could not save this connection"), "error");
    }
  };

  const updateConnectionWait = async (
    connection: CanvasConnection,
    actionId: string,
    stepId: string | undefined,
    waitMs: number,
  ) => {
    const map = options.activeAppMap();
    const canonical = options.canonicalConnectionFor(connection);
    if (!map || !canonical) return;
    const ms = Math.max(0, Math.round(waitMs));
    const actions = updateConnectionWaitActions(canonical.actions, actionId, stepId, ms);
    try {
      await server.runAction("app-map.connection.update", {
        appMapId: map.id,
        connectionId: canonical.id,
        expectedRevision: map.revision,
        patch: { actions },
      });
      await server.refreshAppMaps();
      options.onConnectionActionsChanged(connection.id);
      toast(ms === 0 ? "Pause removed" : "Pause updated", "success");
    } catch (error) {
      toast(humanError(error, "Could not update this pause"), "error");
    }
  };

  const attachBackBehavior = (connection: CanvasConnection) =>
    appendConnectionAction(
      connection,
      { id: `back-${crypto.randomUUID()}`, kind: "back" },
      "Back added to this path",
    );

  const attachAutomaticBehavior = (connection: CanvasConnection) =>
    appendConnectionAction(
      connection,
      { id: `passive-${crypto.randomUUID()}`, kind: "passive", reason: "automatic" },
      "Marked as an automatic path",
    );

  const attachReusableBehavior = async (connection: CanvasConnection, routineId: string) => {
    const map = options.activeAppMap();
    const canonical = options.canonicalConnectionFor(connection);
    if (!map || !canonical || !map.routines[routineId]) return;
    if (
      canonical.actions.some(
        (action) => action.kind === "routine" && action.routineId === routineId,
      )
    ) {
      toast(`${map.routines[routineId]!.name} is already used here`, "info");
      return;
    }
    await appendConnectionAction(
      connection,
      { id: `routine-${crypto.randomUUID()}`, kind: "routine", routineId },
      `Applied ${map.routines[routineId]!.name}`,
    );
  };

  const saveReusableBehavior = async (
    connection: CanvasConnection,
    fallbackActions: ActionSpec[],
    title: string,
  ) => {
    const map = options.activeAppMap();
    if (!map) return;
    const canonical = options.canonicalConnectionFor(connection);
    const actions: ActionSpec[] = canonical?.actions.length
      ? structuredClone(canonical.actions)
      : fallbackActions;
    if (
      !actions.some(
        (action) =>
          (action.kind !== "recorded" && action.kind !== "steps") || action.steps.length > 0,
      )
    )
      return;
    try {
      await server.runAction("app-map.routine.save", {
        appMapId: map.id,
        routineId: `routine-${crypto.randomUUID()}`,
        expectedRevision: map.revision,
        routine: {
          name: title,
          description: "Reusable behavior saved from the App Map",
          actions,
        },
      });
      await server.refreshAppMaps();
      toast(`Saved “${title}” for reuse on other paths`, "success");
    } catch (error) {
      toast(humanError(error, "Could not save this for reuse"), "error");
    }
  };

  return {
    appendConnectionAction,
    updateConnectionWait,
    attachBackBehavior,
    attachAutomaticBehavior,
    attachReusableBehavior,
    saveReusableBehavior,
  };
}
