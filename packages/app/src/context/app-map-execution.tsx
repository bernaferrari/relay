import { createMemo, createSignal } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import type { RecipeStep } from "@relay/protocol";
import { useServer } from "./server";
import { toast } from "./toast";
import { humanError } from "../lib/human-error";
import { connectionStepsFromActions } from "../lib/app-map-projection";
import {
  appMapExecutionPlan,
  connectionUpdateForExecutionStep,
} from "../lib/app-map-execution-plan";

/**
 * Playback/debug projection for the selected App Map.
 *
 * This module has no recipe selection, autosave, history, or CRUD interface.
 * Its rows are derived from canonical Connections. A row edit is translated
 * immediately into a revision-checked Connection mutation.
 */
export const { use: useAppMapExecution, provider: AppMapExecutionProvider } = createSimpleContext({
  name: "AppMapExecution",
  gate: false,
  init: () => {
    const server = useServer();
    const [pending, setPending] = createSignal<{
      appMapId: string;
      steps: RecipeStep[];
      sequence: number;
    } | null>(null);
    let sequence = 0;

    const canonical = createMemo(() =>
      appMapExecutionPlan(server.selectedAppMap()?.connections ?? {}),
    );
    const steps = createMemo(() => {
      const optimistic = pending();
      return optimistic?.appMapId === server.selectedAppMapId()
        ? optimistic.steps
        : canonical().steps;
    });

    async function updateConnectionStep(index: number, step: RecipeStep): Promise<void> {
      const appMap = server.selectedAppMap();
      if (!appMap) return;
      const update = connectionUpdateForExecutionStep({
        connections: appMap.connections,
        index,
        step,
      });
      if (!update) return;
      const mySequence = ++sequence;
      setPending({
        appMapId: appMap.id,
        steps: canonical().steps.map((candidate, candidateIndex) =>
          candidateIndex === index ? structuredClone(step) : structuredClone(candidate),
        ),
        sequence: mySequence,
      });
      try {
        await server.runAction("app-map.connection.update", {
          appMapId: appMap.id,
          connectionId: update.connectionId,
          expectedRevision: appMap.revision,
          patch: { actions: update.actions },
        });
        await server.refreshAppMaps();
      } catch (error) {
        toast(humanError(error, "Could not update this connection"), "error");
      } finally {
        if (pending()?.sequence === mySequence) setPending(null);
      }
    }

    function connectionSteps(connectionId: string): RecipeStep[] {
      const connection = server.selectedAppMap()?.connections[connectionId];
      return connection ? connectionStepsFromActions(connection.actions) : [];
    }

    return { steps, connectionSteps, updateConnectionStep };
  },
});

