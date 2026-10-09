import type { AppMap, AppMapBatchChange, AppMapScenarioTestStep, TestData } from "@relay/protocol";
import type { ProductClientContext } from "./product-client";
import type { ProductSuiteEditor } from "./suite-profile-product-service";
import type { ProductInputDataSetCatalog } from "./plan-input-data-set-service";
import {
  replaceActionText,
  testTextActions,
  type ProductTestTextAction,
} from "./test-text-actions";

export type ProductPlanInputBindingChoice = {
  testId: string;
  stepId: string;
  actionKey: string;
  text: string;
};
export type ProductPlanInputBindingRequest = {
  appMapId: string;
  expectedRevision: number;
  catalogRevision: number;
  inputId: string;
  testIds: readonly string[];
};
export type ProductPlanInputBindingPreview = {
  token: string;
  variableId?: string;
  options: { id: string; value: string }[];
  tests: {
    id: string;
    name: string;
    actions: (ProductTestTextAction & {
      stepId: string;
      stepTitle: string;
      sharedSteps: { testId: string; testName: string; stepId: string; stepTitle: string }[];
    })[];
  }[];
};
export type ProductPlanInputBindingResult = {
  editor: ProductSuiteEditor;
  variableId: string;
  selectedOptionIds?: readonly string[];
};
export type PlanInputBindingService = {
  previewInputBindings(
    input: ProductPlanInputBindingRequest,
  ): Promise<ProductPlanInputBindingPreview>;
};
type BindingCatalog = ProductInputDataSetCatalog & {
  definitions: TestData[];
  appMap: AppMap;
  relay: ProductClientContext["client"];
};

function stepTitles(steps: readonly AppMapScenarioTestStep[]): Map<string, string> {
  return new Map(
    steps.flatMap((step): [string, string][] => [
      [step.id, step.intent],
      ...(step.kind === "loop"
        ? [...stepTitles(step.steps)]
        : step.kind === "decision"
          ? [...stepTitles([...step.thenSteps, ...(step.elseSteps ?? [])])]
          : []),
    ]),
  );
}

function preview(current: BindingCatalog, input: ProductPlanInputBindingRequest) {
  if (current.appMap.revision !== input.expectedRevision)
    throw new TypeError("This app changed. Reload its Data sets and try again.");
  if (current.revision !== input.catalogRevision)
    throw new TypeError("These saved values changed. Reload the Data sets and try again.");
  const definition = current.inputs.find((item) => item.id === input.inputId);
  if (!definition) throw new TypeError("Choose an available shared input with saved values.");
  if (!/^[A-Za-z0-9_.-]+$/u.test(definition.id))
    throw new TypeError(
      "This input ID cannot be used in a text action. Create a new public input.",
    );
  for (const alias of [definition.id, definition.name.trim()]) {
    if (
      current.definitions.filter((item) => [item.id.trim(), item.name.trim()].includes(alias))
        .length !== 1
    )
      throw new TypeError(
        "This input has an ambiguous ID or name. Choose a different public input.",
      );
  }
  const variables = Object.values(current.appMap.variables).filter(
    (variable) => variable.apply.kind === "input" && variable.apply.inputId === definition.id,
  );
  if (variables.length > 1)
    throw new TypeError(
      "This input has multiple Data sets in this app. Choose one in the test editor.",
    );
  const variable = variables[0];
  const options = variable
    ? variable.options.map((row) => {
        if (typeof row.value !== "string" || !definition.values.includes(row.value))
          throw new TypeError("This Data set’s saved values changed. Reload before binding it.");
        return { id: row.id, value: row.value };
      })
    : definition.values.map((value, index) => ({ id: `value-${index + 1}`, value }));
  const usage = Object.values(current.appMap.tests).flatMap((test) => {
    const titles = stepTitles(test.steps);
    return Object.entries(testTextActions(current.appMap, test.id)).flatMap(([stepId, actions]) =>
      actions.map((action) => ({
        key: action.key,
        testId: test.id,
        testName: test.name,
        stepId,
        stepTitle: titles.get(stepId) ?? "Text action",
      })),
    );
  });
  const tests = [...new Set(input.testIds)].map((id) => {
    const test = current.appMap.tests[id];
    if (!test)
      throw new TypeError("A selected test changed. Reload the plan before binding inputs.");
    const titles = stepTitles(test.steps);
    return {
      id,
      name: test.name,
      actions: Object.entries(testTextActions(current.appMap, id)).flatMap(([stepId, actions]) =>
        actions.map((action) => ({
          ...action,
          stepId,
          stepTitle: titles.get(stepId) ?? "Text action",
          sharedSteps: usage
            .filter(
              (other) =>
                other.key === action.key && !(other.testId === id && other.stepId === stepId),
            )
            .map(({ testId, testName, stepId, stepTitle }) => ({
              testId,
              testName,
              stepId,
              stepTitle,
            })),
        })),
      ),
    };
  });
  return {
    token: `{{${definition.id}}}`,
    ...(variable ? { variableId: variable.id } : {}),
    options,
    tests,
  };
}

/** A selected leaf changes its shared Connection. The preview exposes every
 * affected Test instruction before one revision-guarded canonical commit. */
export function createPlanInputBindingService(
  catalog: (appMapId: string) => Promise<BindingCatalog>,
  projectEditor: (map: AppMap) => ProductSuiteEditor,
) {
  return {
    async previewInputBindings(
      input: ProductPlanInputBindingRequest,
    ): Promise<ProductPlanInputBindingPreview> {
      return preview(await catalog(input.appMapId), input);
    },
    async bindInputDataSet(
      input: ProductPlanInputBindingRequest & {
        name: string;
        bindings: readonly ProductPlanInputBindingChoice[];
        selectedOptionIds: readonly string[];
      },
    ): Promise<ProductPlanInputBindingResult> {
      const current = await catalog(input.appMapId);
      const checked = preview(current, input);
      const selectedOptionIds = [...new Set(input.selectedOptionIds)];
      if (
        !selectedOptionIds.length ||
        selectedOptionIds.some((id) => !checked.options.some((row) => row.id === id))
      )
        throw new TypeError("Choose at least one current saved value for this plan.");
      if (!input.bindings.length) throw new TypeError("Choose a text action to use these values.");
      const chosenTests = new Set<string>();
      const chosenLeaves = new Map<string, ProductTestTextAction>();
      for (const choice of input.bindings) {
        const action = checked.tests
          .find((test) => test.id === choice.testId)
          ?.actions.find(
            (item) =>
              item.stepId === choice.stepId &&
              item.key === choice.actionKey &&
              item.text === choice.text,
          );
        if (!action || chosenTests.has(choice.testId))
          throw new TypeError("This text action changed. Reload the test choices before saving.");
        chosenTests.add(choice.testId);
        chosenLeaves.set(action.key, action);
      }
      const variableId = checked.variableId ?? `input-${crypto.randomUUID()}`;
      const changes: AppMapBatchChange[] = [];
      if (!checked.variableId) {
        const name = input.name.trim();
        if (!name) throw new TypeError("Give this Data set a name.");
        const now = Date.now();
        changes.push({
          kind: "variable.save",
          variable: {
            id: variableId,
            organizationId: current.appMap.organizationId,
            projectId: current.appMap.projectId,
            appMapId: current.appMap.id,
            createdAt: now,
            updatedAt: now,
            name,
            kind: "custom",
            apply: { kind: "input", inputId: input.inputId },
            options: checked.options.map(({ id, value }) => ({
              id,
              value,
              label: value.length > 72 ? `${value.slice(0, 71)}…` : value,
            })),
          },
        });
      }
      const connections = new Map<string, AppMap["connections"][string]["actions"]>();
      for (const action of chosenLeaves.values()) {
        if (action.text === checked.token) continue;
        connections.set(
          action.connectionId,
          replaceActionText(
            connections.get(action.connectionId) ??
              current.appMap.connections[action.connectionId]!.actions,
            action,
            checked.token,
          ),
        );
      }
      for (const [connectionId, actions] of connections)
        changes.push({ kind: "connection.update", connectionId, patch: { actions } });
      const appMap = changes.length
        ? (
            await current.relay.invoke("app-map.commit", {
              appMapId: input.appMapId,
              expectedRevision: input.expectedRevision,
              summary: "Connect plan prompt values to selected test text actions",
              changes,
            })
          ).appMap
        : current.appMap;
      return { editor: projectEditor(appMap), variableId, selectedOptionIds };
    },
  };
}
