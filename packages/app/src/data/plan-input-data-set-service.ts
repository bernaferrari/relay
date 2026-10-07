import type { AppMap } from "@relay/protocol";
import type { ProductClientContext } from "./product-client";
import type { ProductSuiteEditor } from "./suite-profile-product-service";

export type ProductInputDataSetCatalog = {
  revision: number;
  inputs: { id: string; name: string; values: string[] }[];
};

export type ProductInputDataSetInput = {
  appMapId: string;
  expectedRevision: number;
  catalogRevision: number;
  inputId: string;
  name: string;
};

export type PlanInputDataSetService = {
  listInputDataSets(appMapId: string): Promise<ProductInputDataSetCatalog>;
  addInputDataSet(input: ProductInputDataSetInput): Promise<{
    editor: ProductSuiteEditor;
    variableId: string;
  }>;
};

/** Product projection only. Canonical persistence and Run admission independently
 * check approval against the current Project inputs. */
export function createPlanInputDataSetService(
  client: () => Promise<ProductClientContext["client"]>,
  projectEditor: (map: AppMap) => ProductSuiteEditor,
): PlanInputDataSetService {
  async function catalog(appMapId: string) {
    const relay = await client();
    const [data, { appMap }] = await Promise.all([
      relay.invoke("workspace.variables.get", {}),
      relay.invoke("app-map.get", { appMapId }),
    ]);
    const linked = new Set(
      Object.values(appMap.variables).flatMap((variable) =>
        variable.apply.kind === "input" ? [variable.apply.inputId] : [],
      ),
    );
    const inputs = data.value
      .filter(
        (item) =>
          item.scope === "shared" &&
          !item.sensitive &&
          (item.source === "static" || item.source === "list") &&
          !linked.has(item.id),
      )
      .map((item) => {
        const values = [...new Set(item.values?.map((value) => value.trim()).filter(Boolean))];
        return {
          id: item.id,
          name: item.name,
          values: item.source === "static" ? values.slice(0, 1) : values,
        };
      })
      .filter((item) => item.values.length > 0);
    return { revision: data.revision, inputs, appMap };
  }
  return {
    async listInputDataSets(appMapId) {
      const { revision, inputs } = await catalog(appMapId);
      return { revision, inputs };
    },
    async addInputDataSet(input) {
      const current = await catalog(input.appMapId);
      if (current.appMap.revision !== input.expectedRevision)
        throw new TypeError("This App changed. Reload its Data sets and try again.");
      if (current.revision !== input.catalogRevision)
        throw new TypeError("These saved values changed. Reload the Data sets and try again.");
      const definition = current.inputs.find((item) => item.id === input.inputId);
      if (!definition) throw new TypeError("Choose an available shared input with saved values.");
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
