import { validateRecipeSteps } from "@relay/core/recipes";
import { operationDefinition } from "@relay/protocol";
import type { AppMapVariable, RecipeStep, OperationInput } from "@relay/protocol";
import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";
import { createRelayWorkflows } from "./relay-workflows.js";
import type { RepeatTestIntent } from "./types.js";

export type BrowserCapturePlan = {
  appMapId: string;
  id: string;
  name: string;
  expectedRevision: number;
  /** Reviewed website picker navigation and observed values. The browser's
   * Accept-Language environment is deliberately not a substitute. */
  language: Pick<AppMapVariable, "apply" | "options" | "restoreId">;
  views: Array<{ id: string; name: string; steps: RecipeStep[] }>;
};

/** Author once, then use normal durable Repeat runs. No per-locale scripts,
 * alternative run store, or inferred website language navigation. */
export function createBrowserCaptureWorkflow(client: RelayInvokeClient) {
  const operations = createRelayOperationPort(client);
  return {
    async save(plan: BrowserCapturePlan) {
      if (
        !Array.isArray(plan.views) ||
        !plan.views.length ||
        new Set(plan.views.map((view) => view.id)).size !== plan.views.length
      ) {
        throw new Error("Capture views must have unique IDs and include at least one view.");
      }
      if (!Array.isArray(plan.language?.options) || !plan.language.options.length)
        throw new Error("Choose at least one observed website language.");
      const { appMap: initial } = await operations.invoke("app-map.get", {
        appMapId: plan.appMapId,
      });
      if (initial.revision !== plan.expectedRevision)
        throw new Error(
          "The App Map changed. Read its current revision before saving the capture plan.",
        );
      const at = Date.now();
      const scope = {
        organizationId: initial.organizationId,
        projectId: initial.projectId,
        appMapId: initial.id,
        createdAt: at,
        updatedAt: at,
      };
      const variableId = `${plan.id}-language`,
        routineId = `${plan.id}-captures`;
      const routine = {
        name: plan.name,
        actions: plan.views.map((view) => ({
          id: view.id,
          kind: "steps" as const,
          steps: validateRecipeSteps([
            ...view.steps,
            { kind: "screenshot" as const, caption: view.name },
          ]),
        })),
      };
      // Validate the entire authored action set before the first write.
      operationDefinition("app-map.routine.save").input.parse({
        appMapId: plan.appMapId,
        routineId,
        expectedRevision: initial.revision,
        routine,
      });
      const testInput = operationDefinition("app-map.test.save").input.parse({
        appMapId: plan.appMapId,
        testId: plan.id,
        expectedRevision: initial.revision,
        test: {
          name: plan.name,
          kind: "scenario",
          intentSchemaVersion: 1,
          steps: [
            {
              id: "capture-views",
              kind: "module",
              intent: `Capture ${plan.views.map((view) => view.name).join(" and ")}`,
              binding: { status: "resolved", kind: "routine", routineId },
            },
          ],
        },
      }) as OperationInput<"app-map.test.save">;
      const { appMap: withLanguage } = await operations.invoke("app-map.variable.save", {
        appMapId: plan.appMapId,
        variableId,
        expectedRevision: initial.revision,
        variable: {
          ...scope,
          id: variableId,
          name: `${plan.name} languages`,
          kind: "language",
          ...plan.language,
        },
      });
      const { appMap: withRoutine } = await operations.invoke("app-map.routine.save", {
        appMapId: plan.appMapId,
        routineId,
        expectedRevision: withLanguage.revision,
        routine,
      });
      const saved = await operations.invoke("app-map.test.save", {
        ...testInput,
        expectedRevision: withRoutine.revision,
      });
      return { appMap: saved.appMap, testId: plan.id, variableId };
    },
    run(intent: RepeatTestIntent) {
      if (intent.target.kind !== "browser")
        throw new Error("Browser capture requires a browser target.");
      return createRelayWorkflows(client).start(intent);
    },
    export(batchId: string) {
      return operations.invoke("job.combine.export", { batchId });
    },
  };
}
