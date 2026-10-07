import { describe, expect, it, vi } from "vitest";
import type { AppMap, TestData } from "@relay/protocol";
import type { ProductClientContext } from "./product-client";
import { createPlanInputDataSetService } from "./plan-input-data-set-service";

const definition: TestData = {
  id: "grok-chat-prompt",
  name: "chat_prompt",
  scope: "shared",
  source: "list",
  values: [
    "Explain paper airplanes in three sentences.",
    "Suggest a friendly name for a tiny orange boat.",
  ],
};
const map = {
  id: "grok",
  organizationId: "local",
  projectId: "default",
  revision: 4,
  variables: {},
} as AppMap;
function fixture(definitions: TestData[] = [definition], appMap = map, revision = 2) {
  const invoke = vi.fn(async (operation: string, input: unknown) => {
    if (operation === "workspace.variables.get") return { revision, value: definitions };
    if (operation === "app-map.get") return { appMap };
    if (operation === "app-map.variable.save") return { appMap: { ...appMap, revision: 5 } };
    throw new Error(`Unexpected operation ${operation}: ${JSON.stringify(input)}`);
  });
  const client = { invoke } as unknown as ProductClientContext["client"];
  const project = vi.fn(() => ({
    appMapId: "grok",
    appName: "Grok",
    revision: 5,
    tests: [],
    dataSets: [],
  }));
  return { invoke, service: createPlanInputDataSetService(async () => client, project), project };
}
const input = {
  appMapId: "grok",
  expectedRevision: 4,
  catalogRevision: 2,
  inputId: definition.id,
  name: "Chat prompts",
};
describe("Plan input Data sets", () => {
  it("offers only saved shared, non-sensitive inputs and excludes ones already added", async () => {
    const { service } = fixture(
      [
        definition,
        { ...definition, id: "private", scope: "private" },
        { ...definition, id: "secret", sensitive: true },
        { ...definition, id: "generated", source: "generated" },
        { ...definition, id: "empty", values: [" "] },
        { ...definition, id: "already-linked" },
        { ...definition, id: "static", source: "static" },
      ],
      {
        ...map,
        variables: {
          linked: {
            id: "linked",
            organizationId: "local",
            projectId: "default",
            appMapId: "grok",
            createdAt: 1,
            updatedAt: 1,
            name: "Linked prompts",
            kind: "custom",
            apply: { kind: "input", inputId: "already-linked" },
            options: [{ id: "first", value: "A saved prompt" }],
          },
        },
      } as AppMap,
    );
    expect(await service.listInputDataSets("grok")).toEqual({
      revision: 2,
      inputs: [
        { id: definition.id, name: definition.name, values: definition.values },
        { id: "static", name: definition.name, values: definition.values!.slice(0, 1) },
      ],
    });
  });
  it("persists the exact approved prompt separately from its bounded row identity and display label", async () => {
    const prompt = "A useful generation prompt. ".repeat(20);
    const { service, invoke, project } = fixture([{ ...definition, values: [prompt] }]);
    const result = await service.addInputDataSet(input);
    const write = invoke.mock.calls.find(
      ([operation]) => operation === "app-map.variable.save",
    )![1];
    expect(write).toMatchObject({
      appMapId: "grok",
      expectedRevision: 4,
      variable: {
        kind: "custom",
        apply: { kind: "input", inputId: definition.id },
        options: [{ id: "value-1", value: prompt.trim(), label: expect.any(String) }],
      },
    });
    const variable = (write as { variable: { id: string; options: { label: string }[] } }).variable;
    expect(variable.options[0]!.label.length).toBeLessThanOrEqual(72);
    expect(result.variableId).toBe(variable.id);
    expect(result.editor.revision).toBe(5);
    expect(project).toHaveBeenCalledOnce();
  });
  it.each([
    { change: { expectedRevision: 3 }, message: "This App changed" },
    { change: { catalogRevision: 1 }, message: "saved values changed" },
    { change: { inputId: "chat_prompt" }, message: "available shared input" },
  ])(
    "rejects stale or alias-based choices before a write: $message",
    async ({ change, message }) => {
      const { service, invoke } = fixture();
      await expect(service.addInputDataSet({ ...input, ...change })).rejects.toThrow(message);
      expect(invoke.mock.calls.some(([operation]) => operation === "app-map.variable.save")).toBe(
        false,
      );
    },
  );
  it("passes a canonical write rejection back without retrying it", async () => {
    const { service, invoke } = fixture();
    invoke.mockImplementation(async (operation) => {
      if (operation === "workspace.variables.get") return { revision: 2, value: [definition] };
      if (operation === "app-map.get") return { appMap: map };
      throw new Error("Project values changed before persistence");
    });
    await expect(service.addInputDataSet(input)).rejects.toThrow("before persistence");
    expect(
      invoke.mock.calls.filter(([operation]) => operation === "app-map.variable.save"),
    ).toHaveLength(1);
  });
});
