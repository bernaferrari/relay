import { describe, expect, it, vi } from "vitest";
import type { AppMap, TestData } from "@relay/protocol";
import { RelayClient } from "@relay/client";
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
function fixture(
  definitions: TestData[] = [definition],
  appMap = map,
  revision = 2,
  otherMaps: AppMap[] = [],
) {
  const invoke = vi.fn(async (operation: string, input: unknown) => {
    if (operation === "workspace.variables.get") return { revision, value: definitions };
    if (operation === "app-map.get") return { appMap };
    if (operation === "app-map.list") return { appMaps: [appMap, ...otherMaps] };
    if (operation === "workspace.variables.update") {
      const write = input as { value: TestData[]; preserveInputIds: string[] };
      definitions = [
        ...definitions.filter((item) => write.preserveInputIds.includes(item.id)),
        ...write.value,
      ];
      return { revision: ++revision, value: definitions };
    }
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
  it("keeps equal prompts as distinct execution rows", async () => {
    const values = ["Same prompt", "Same prompt"];
    const { service, invoke } = fixture([{ ...definition, values }]);
    expect((await service.listInputDataSets("grok")).inputs[0]!.values).toEqual(values);
    await service.addInputDataSet(input);
    const write = invoke.mock.calls.find(
      ([operation]) => operation === "app-map.variable.save",
    )![1];
    expect(write).toMatchObject({
      variable: {
        options: [
          { id: "value-1", value: "Same prompt" },
          { id: "value-2", value: "Same prompt" },
        ],
      },
    });
  });
  it("offers public inputs with separate Project usage and current app linkage", async () => {
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
        {
          id: definition.id,
          name: definition.name,
          source: "list",
          values: definition.values,
          linked: false,
          addedToApp: false,
        },
        {
          id: "already-linked",
          name: definition.name,
          source: "list",
          values: definition.values,
          linked: true,
          addedToApp: true,
        },
        {
          id: "static",
          name: definition.name,
          source: "static",
          values: definition.values!.slice(0, 1),
          linked: false,
          addedToApp: false,
        },
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
        options: [{ id: "value-1", value: prompt, label: expect.any(String) }],
      },
    });
    const variable = (write as { variable: { id: string; options: { label: string }[] } }).variable;
    expect(variable.options[0]!.label.length).toBeLessThanOrEqual(72);
    expect(result.variableId).toBe(variable.id);
    expect(result.editor.revision).toBe(5);
    expect(project).toHaveBeenCalledOnce();
  });
  it.each([
    { change: { expectedRevision: 3 }, message: "This app changed" },
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
      if (operation === "app-map.list") return { appMaps: [map] };
      throw new Error("Project values changed before persistence");
    });
    await expect(service.addInputDataSet(input)).rejects.toThrow("before persistence");
    expect(
      invoke.mock.calls.filter(([operation]) => operation === "app-map.variable.save"),
    ).toHaveLength(1);
  });
  it("creates full public prompt values without submitting redacted or unrelated definitions", async () => {
    const secret: TestData = {
      ...definition,
      id: "secret",
      name: "secret",
      sensitive: true,
      values: ["[REDACTED]"],
    };
    const unrelated: TestData = {
      id: "private",
      name: "private",
      scope: "private",
      source: "generated",
      prompt: "Local value",
    };
    const redactedPublic = {
      ...definition,
      id: "public-token",
      name: "public_token",
      values: ["Bearer [REDACTED]"],
    };
    const { service, invoke, project } = fixture([secret, unrelated, redactedPublic]);
    const values = ["  First line\nSecond line.\n ", "\n  A second prompt with spacing.  "];
    const draft = {
      appMapId: map.id,
      catalogRevision: 2,
      name: " chat_prompt ",
      source: "list" as const,
      values,
    };
    const before = structuredClone(draft);
    const result = await service.saveInputDefinition(draft);
    const writes = invoke.mock.calls.filter(
      ([operation]) => operation === "workspace.variables.update",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]![1]).toEqual({
      expectedRevision: 2,
      preserveInputIds: ["secret", "private", "public-token"],
      value: [
        {
          id: result.inputId,
          name: "chat_prompt",
          scope: "shared",
          source: "list",
          sensitive: false,
          values,
        },
      ],
    });
    expect(JSON.stringify(writes[0]![1])).not.toContain("REDACTED");
    expect(result.catalog).toEqual({
      revision: 3,
      inputs: [
        {
          id: result.inputId,
          name: "chat_prompt",
          source: "list",
          values,
          linked: false,
          addedToApp: false,
        },
      ],
    });
    expect(draft).toEqual(before);
    expect(project).not.toHaveBeenCalled();
    expect(invoke.mock.calls.some(([operation]) => operation === "app-map.variable.save")).toBe(
      false,
    );
  });
  it("edits by exact stable ID and returns the canonical catalog acknowledgement", async () => {
    const { service, invoke } = fixture();
    const result = await service.saveInputDefinition({
      appMapId: map.id,
      catalogRevision: 2,
      inputId: definition.id,
      name: "chat_prompt",
      source: "static",
      values: ["  One full\nstatic prompt.  "],
    });
    expect(result.inputId).toBe(definition.id);
    expect(result.catalog.inputs[0]).toMatchObject({
      id: definition.id,
      source: "static",
      values: ["  One full\nstatic prompt.  "],
    });
    expect(
      invoke.mock.calls.find(([operation]) => operation === "workspace.variables.update")![1],
    ).toMatchObject({
      expectedRevision: 2,
      preserveInputIds: [],
      requireUnlinkedInputIds: [definition.id],
      value: [{ id: definition.id, source: "static" }],
    });
  });
  it.each([
    { patch: { name: " " }, message: "Give this input a name" },
    { patch: { values: [] }, message: "at least one" },
    { patch: { values: ["first", " \n "] }, message: "value 2" },
    { patch: { source: "static" as const, values: ["one", "two"] }, message: "exactly one" },
    { patch: { values: ["a".repeat(20_001)] }, message: "too long" },
    { patch: { values: ["Bearer [REDACTED]"] }, message: "is redacted" },
    { patch: { catalogRevision: 1 }, message: "saved values changed" },
    { patch: { inputId: "chat_prompt" }, message: "available public" },
    { patch: { name: definition.name }, message: "already in use" },
  ])(
    "rejects invalid or stale definition drafts without mutation: $message",
    async ({ patch, message }) => {
      const { service, invoke } = fixture();
      const draft = {
        appMapId: map.id,
        catalogRevision: 2,
        name: "new_prompt",
        source: "list" as const,
        values: ["Full prompt"],
        ...patch,
      };
      const before = structuredClone(draft);
      await expect(service.saveInputDefinition(draft)).rejects.toThrow(message);
      expect(
        invoke.mock.calls.some(([operation]) => operation === "workspace.variables.update"),
      ).toBe(false);
      expect(draft).toEqual(before);
    },
  );
  it("rejects edits of sensitive definitions even when their values are redacted", async () => {
    const { service, invoke } = fixture([
      { ...definition, sensitive: true, values: ["[REDACTED]"] },
    ]);
    await expect(
      service.saveInputDefinition({
        appMapId: map.id,
        catalogRevision: 2,
        inputId: definition.id,
        name: definition.name,
        source: "list",
        values: ["Replacement"],
      }),
    ).rejects.toThrow("available public");
    expect(
      invoke.mock.calls.some(([operation]) => operation === "workspace.variables.update"),
    ).toBe(false);
  });
  it("excludes redacted public definitions from both linking and editing", async () => {
    const { service, invoke } = fixture([{ ...definition, values: ["Bearer [REDACTED]"] }]);
    expect((await service.listInputDataSets(map.id)).inputs).toEqual([]);
    await expect(service.addInputDataSet(input)).rejects.toThrow("available shared input");
    await expect(
      service.saveInputDefinition({
        appMapId: map.id,
        catalogRevision: 2,
        inputId: definition.id,
        name: definition.name,
        source: "list",
        values: ["Replacement"],
      }),
    ).rejects.toThrow("available public");
    expect(
      invoke.mock.calls.some(
        ([operation]) =>
          operation === "workspace.variables.update" || operation === "app-map.variable.save",
      ),
    ).toBe(false);
  });
  it("protects definitions linked in another Project app while allowing an explicit new link here", async () => {
    const other = {
      ...map,
      id: "another-app",
      variables: {
        linked: {
          id: "other-dimension",
          apply: { kind: "input", inputId: definition.id },
          options: [],
        },
      },
    } as unknown as AppMap;
    const { service, invoke } = fixture([definition], map, 2, [other]);
    expect((await service.listInputDataSets(map.id)).inputs[0]).toMatchObject({
      linked: true,
      addedToApp: false,
    });
    await expect(
      service.saveInputDefinition({
        appMapId: map.id,
        catalogRevision: 2,
        inputId: definition.id,
        name: definition.name,
        source: "list",
        values: ["Replacement"],
      }),
    ).rejects.toThrow("app in this Project");
    expect(
      invoke.mock.calls.some(([operation]) => operation === "workspace.variables.update"),
    ).toBe(false);
    await expect(service.addInputDataSet(input)).resolves.toMatchObject({
      variableId: expect.any(String),
    });
  });
  it("retains a rejected draft and does not retry a canonical write", async () => {
    const { service, invoke } = fixture();
    const original = invoke.getMockImplementation()!;
    const rejection = new Error("The Project values changed before persistence");
    invoke.mockImplementation(async (operation, input) => {
      if (operation === "workspace.variables.update") throw rejection;
      return original(operation, input);
    });
    const draft = {
      appMapId: map.id,
      catalogRevision: 2,
      name: "new_prompt",
      source: "list" as const,
      values: ["  Preserve this\nfailed draft.  "],
    };
    const before = structuredClone(draft);
    await expect(service.saveInputDefinition(draft)).rejects.toBe(rejection);
    expect(draft).toEqual(before);
    expect(
      invoke.mock.calls.filter(([operation]) => operation === "workspace.variables.update"),
    ).toHaveLength(1);
  });
  it("uses the canonical scoped client transport for public definition persistence", async () => {
    const requests: { path: string; method: string; headers: Headers; body?: unknown }[] = [];
    const values = ["  First transport\nprompt.  ", "Second transport prompt."];
    const relay = new RelayClient(
      {
        url: "http://relay.test",
        auth: { type: "none" },
        organizationId: "local",
        projectId: "default",
        actorId: "human:prompt-editor",
        actorKind: "human",
      },
      {
        fetch: async (url, init) => {
          const path = new URL(String(url)).pathname;
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
          requests.push({
            path,
            method: init?.method ?? "GET",
            headers: new Headers(init?.headers),
            body,
          });
          const result =
            path === "/project/variables"
              ? init?.method === "PUT"
                ? { revision: 3, updatedAt: 2, value: body.value }
                : { revision: 2, updatedAt: 1, value: [] }
              : path === "/app-maps"
                ? { appMaps: [map] }
                : { appMap: map };
          return new Response(JSON.stringify(result), {
            headers: { "content-type": "application/json" },
          });
        },
      },
    );
    const service = createPlanInputDataSetService(async () => relay, vi.fn());
    const result = await service.saveInputDefinition({
      appMapId: map.id,
      catalogRevision: 2,
      name: "chat_prompt",
      source: "list",
      values,
    });
    const write = requests.find((request) => request.method === "PUT")!;
    expect(write.path).toBe("/project/variables");
    expect(write.headers.get("x-project-id")).toBe("default");
    expect(write.headers.get("x-relay-operation-id")).toBe("workspace.variables.update");
    expect(write.body).toMatchObject({
      expectedRevision: 2,
      preserveInputIds: [],
      value: [{ values, scope: "shared", sensitive: false }],
    });
    expect(result.catalog.inputs[0]!.values).toEqual(values);
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(1);
  });
});
