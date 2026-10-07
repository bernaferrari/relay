import {
  MAX_INPUT_DATA_SET_VALUE_LENGTH,
  REDACTED,
  type AppMap,
  type TestData,
} from "@relay/protocol";
import type { ProductClientContext } from "./product-client";
import type { ProductSuiteEditor } from "./suite-profile-product-service";
import {
  createPlanInputBindingService,
  type PlanInputBindingService,
  type ProductPlanInputBindingChoice,
  type ProductPlanInputBindingResult,
} from "./plan-input-binding-service";

export type ProductInputDataSetCatalog = {
  revision: number;
  inputs: {
    id: string;
    name: string;
    source: "static" | "list";
    values: string[];
    linked: boolean;
    addedToApp: boolean;
  }[];
};

export type ProductInputDataSetInput = {
  appMapId: string;
  expectedRevision: number;
  catalogRevision: number;
  inputId: string;
  name: string;
  testIds?: readonly string[];
  bindings?: readonly ProductPlanInputBindingChoice[];
  selectedOptionIds?: readonly string[];
};

export type PlanInputDataSetService = PlanInputBindingService & {
  listInputDataSets(appMapId: string): Promise<ProductInputDataSetCatalog>;
  saveInputDefinition(input: {
    appMapId: string;
    catalogRevision: number;
    inputId?: string;
    name: string;
    source: "static" | "list";
    values: string[];
  }): Promise<{ catalog: ProductInputDataSetCatalog; inputId: string }>;
  addInputDataSet(input: ProductInputDataSetInput): Promise<ProductPlanInputBindingResult>;
};

/** Product projection only. Canonical persistence and Run admission independently
 * check approval against the current Project inputs. */
export function createPlanInputDataSetService(
  client: () => Promise<ProductClientContext["client"]>,
  projectEditor: (map: AppMap) => ProductSuiteEditor,
): PlanInputDataSetService {
  const redacted = (definition: TestData) =>
    [definition.name, definition.prompt, definition.fallback, ...(definition.values ?? [])].some(
      (value) => value?.includes(REDACTED),
    );
  function projectCatalog(
    revision: number,
    definitions: readonly TestData[],
    appMaps: readonly AppMap[],
  ): ProductInputDataSetCatalog {
    const linked = new Set(
      appMaps.flatMap((appMap) =>
        Object.values(appMap.variables).flatMap((variable) =>
          variable.apply.kind === "input" ? [variable.apply.inputId] : [],
        ),
      ),
    );
    const inputs = definitions
      .filter(
        (item): item is TestData & { source: "static" | "list" } =>
          item.scope === "shared" &&
          !item.sensitive &&
          !redacted(item) &&
          (item.source === "static" || item.source === "list"),
      )
      .map((item) => {
        // Equal text still represents separate selected execution rows.
        const values = item.values?.filter((value) => value.trim().length > 0) ?? [];
        return {
          id: item.id,
          name: item.name,
          source: item.source,
          values: item.source === "static" ? values.slice(0, 1) : values,
          linked: linked.has(item.id),
          addedToApp: Object.values(appMaps[0]!.variables).some(
            (variable) => variable.apply.kind === "input" && variable.apply.inputId === item.id,
          ),
        };
      })
      .filter((item) => item.values.length > 0);
    return { revision, inputs };
  }
  async function catalog(appMapId: string) {
    const relay = await client();
    const [data, { appMap }, { appMaps }] = await Promise.all([
      relay.invoke("workspace.variables.get", {}),
      relay.invoke("app-map.get", { appMapId }),
      relay.invoke("app-map.list", {}),
    ]);
    const projectMaps = [
      appMap,
      ...appMaps.filter(
        (item) =>
          item.id !== appMap.id &&
          item.projectId === appMap.projectId &&
          item.organizationId === appMap.organizationId,
      ),
    ];
    return {
      ...projectCatalog(data.revision, data.value, projectMaps),
      definitions: data.value,
      appMap,
      projectMaps,
      relay,
    };
  }
  const binding = createPlanInputBindingService(catalog, projectEditor);
  return {
    previewInputBindings: binding.previewInputBindings,
    async listInputDataSets(appMapId) {
      const { revision, inputs } = await catalog(appMapId);
      return { revision, inputs };
    },
    async saveInputDefinition(input) {
      const name = input.name.trim();
      if (!name) throw new TypeError("Give this input a name.");
      if (!(input.source === "list" || input.source === "static"))
        throw new TypeError("Choose a list or one static value.");
      if (!input.values.length) throw new TypeError("Add at least one prompt value.");
      if (input.source === "static" && input.values.length !== 1)
        throw new TypeError("A static input needs exactly one value.");
      for (const [index, value] of input.values.entries()) {
        if (!value.trim()) throw new TypeError(`Add a prompt for value ${index + 1}.`);
        if (value.includes(REDACTED))
          throw new TypeError(`Value ${index + 1} is redacted. Use public prompt text.`);
        if (value.length > MAX_INPUT_DATA_SET_VALUE_LENGTH)
          throw new TypeError(
            `Value ${index + 1} is too long (maximum ${MAX_INPUT_DATA_SET_VALUE_LENGTH} characters).`,
          );
      }
      const current = await catalog(input.appMapId);
      if (current.revision !== input.catalogRevision)
        throw new TypeError("These saved values changed. Reload the Data sets and try again.");
      const existing =
        input.inputId === undefined
          ? undefined
          : current.definitions.find((item) => item.id === input.inputId);
      if (
        input.inputId !== undefined &&
        (!existing ||
          existing.scope !== "shared" ||
          existing.sensitive ||
          redacted(existing) ||
          !(existing.source === "list" || existing.source === "static"))
      )
        throw new TypeError("Choose an available public list or static input to edit.");
      if (
        existing &&
        current.projectMaps.some((map) =>
          Object.values(map.variables).some(
            (variable) => variable.apply.kind === "input" && variable.apply.inputId === existing.id,
          ),
        )
      )
        throw new TypeError(
          "This input is already used by an App in this Project. Create a new input to keep existing Plans unchanged.",
        );
      const inputId = existing?.id ?? `input-${crypto.randomUUID()}`;
      if (
        current.definitions.some(
          (item) => item.id !== inputId && (item.name === name || item.id === name),
        ) ||
        (name !== inputId && current.definitions.some((item) => item.name === inputId))
      )
        throw new TypeError("This input name is already in use. Choose a different name.");
      const value: TestData = {
        ...existing,
        id: inputId,
        name,
        scope: "shared",
        source: input.source,
        sensitive: false,
        values: [...input.values],
      };
      const saved = await current.relay.invoke("workspace.variables.update", {
        expectedRevision: input.catalogRevision,
        value: [value],
        preserveInputIds: current.definitions
          .filter((item) => item.id !== inputId)
          .map((item) => item.id),
        ...(existing ? { requireUnlinkedInputIds: [existing.id] } : {}),
      });
      return { catalog: projectCatalog(saved.revision, saved.value, current.projectMaps), inputId };
    },
    async addInputDataSet(input) {
      if (input.bindings !== undefined)
        return binding.bindInputDataSet({
          ...input,
          testIds: input.testIds ?? [],
          bindings: input.bindings,
          selectedOptionIds: input.selectedOptionIds ?? [],
        });
      const current = await catalog(input.appMapId);
      if (current.appMap.revision !== input.expectedRevision)
        throw new TypeError("This App changed. Reload its Data sets and try again.");
      if (current.revision !== input.catalogRevision)
        throw new TypeError("These saved values changed. Reload the Data sets and try again.");
      const definition = current.inputs.find((item) => item.id === input.inputId);
      if (!definition || definition.addedToApp)
        throw new TypeError("Choose an available shared input with saved values.");
      const name = input.name.trim();
      if (!name) throw new TypeError("Give this Data set a name.");
      const variableId = `input-${crypto.randomUUID()}`;
      const now = Date.now();
      const { appMap } = await (
        await client()
      ).invoke("app-map.variable.save", {
        appMapId: input.appMapId,
        variableId,
        expectedRevision: input.expectedRevision,
        variable: {
          id: variableId,
          organizationId: current.appMap.organizationId,
          projectId: current.appMap.projectId,
          appMapId: current.appMap.id,
          createdAt: now,
          updatedAt: now,
          name,
          kind: "custom",
          apply: { kind: "input", inputId: definition.id },
          options: definition.values.map((value, index) => ({
            id: `value-${index + 1}`,
            label: value.length > 72 ? `${value.slice(0, 71)}…` : value,
            value,
          })),
        },
      });
      return { editor: projectEditor(appMap), variableId };
    },
  };
}
