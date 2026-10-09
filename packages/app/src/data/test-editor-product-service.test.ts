import { describe, expect, it, vi } from "vitest";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { createTestEditorProductService, documentFromMap } from "./test-editor-product-service";

const clientRef = vi.hoisted(() => ({ current: { invoke: vi.fn() } }));

vi.mock("./product-client", () => ({
  productClientForPlatform: vi.fn(async () => ({
    client: clientRef.current,
    actorId: "human:test-editor",
  })),
}));

const platform = { platform: "web", storage: {} } as never;
const test: AppMapScenarioTest = {
  id: "checkout",
  organizationId: "acme",
  projectId: "mobile",
  appMapId: "store",
  createdAt: 1,
  updatedAt: 1,
  name: "Checkout",
  kind: "scenario",
  intentSchemaVersion: 1,
  steps: [],
};

function map(revision: number, name = test.name): AppMap {
  return {
    id: "store",
    name: "Store",
    revision,
    tests: { checkout: { ...test, name } },
    screens: {},
    screenVariants: {},
    connections: {},
    activity: {},
    proposals: {},
  } as unknown as AppMap;
}

describe("Test editor product history transport", () => {
  it("projects a captured native send step into a display title while keeping editable intent and selectors", () => {
    const current = map(3);
    const step = {
      id: "send",
      kind: "instruction" as const,
      intent: "Tap “input_send_button”",
      binding: {
        status: "resolved" as const,
        kind: "connections" as const,
        connectionIds: ["send"],
      },
    };
    current.tests.checkout = { ...test, steps: [step] };
    const scope = {
      organizationId: test.organizationId,
      projectId: test.projectId,
      appMapId: current.id,
      createdAt: 1,
      updatedAt: 1,
    };
    current.screens.composer = {
      ...scope,
      id: "composer",
      title: "Grok home",
      variantIds: ["composer-android"],
      identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
    };
    current.screenVariants["composer-android"] = {
      ...scope,
      id: "composer-android",
      screenId: "composer",
      evidenceIds: [],
      targetProfile: {
        id: "phone",
        name: "Phone",
        targetId: "phone",
        source: "device",
        platform: "android",
        capabilities: [],
        observedAt: 1,
      },
      observation: {
        fingerprint: "a".repeat(64),
        volatileSignals: [],
        nodes: [
          { role: "android.widget.linearlayout", identifier: "ai.x.grok:id/action_bar_root" },
          { role: "android.view.view", identifier: "input_send_button", hittable: true },
        ],
      },
    };
    current.connections.send = {
      ...scope,
      id: "send",
      fromScreenId: "composer",
      destination: { kind: "screen", screenId: "composer" },
      state: "ready",
      label: step.intent,
      actions: [{ id: "send-action", kind: "tap", target: { identifier: "input_send_button" } }],
    };
    const before = structuredClone(current);
    const document = documentFromMap(current, "checkout")!;
    expect(document.displayTitles).toEqual({ send: "Tap “Send message”" });
    expect(document.test.steps[0]!.intent).toBe("Tap “input_send_button”");
    expect(current).toEqual(before);
    step.intent = "Submit the expert request";
    expect(documentFromMap(current, "checkout")!.displayTitles).toEqual({});
  });
  it("opens the selected app's test when another app uses the same ID", async () => {
    const service = createTestEditorProductService(platform);
    const other = {
      ...map(7, "Admin checkout"),
      id: "admin",
      name: "Admin",
      tests: {
        checkout: { ...test, appMapId: "admin", name: "Admin checkout" },
      },
    };
    clientRef.current.invoke.mockResolvedValue({ appMaps: [map(3), other] });

    await expect(service.get("checkout")).rejects.toThrow("more than one app");
    expect((await service.get("checkout", "store"))?.appMapId).toBe("store");
    expect((await service.get("checkout", "admin"))?.test.name).toBe("Admin checkout");
    clientRef.current.invoke.mockReset();
  });

  it("invokes server-owned undo and redo with the document revision", async () => {
    const service = createTestEditorProductService(platform);
    const document = {
      appMapId: "store",
      appName: "Store",
      revision: 3,
      test,
      history: [],
      repairs: [],
    };
    clientRef.current.invoke
      .mockResolvedValueOnce({ appMap: map(4) })
      .mockResolvedValueOnce({ appMap: map(5, "Checkout v2") });

    const undone = await service.undo!({ document });
    expect(undone.revision).toBe(4);
    expect(clientRef.current.invoke).toHaveBeenNthCalledWith(1, "app-map.test.undo", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: 3,
    });

    const redone = await service.redo!({ document: undone });
    expect(redone.revision).toBe(5);
    expect(clientRef.current.invoke).toHaveBeenNthCalledWith(2, "app-map.test.redo", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: 4,
    });
  });

  it("saves edited test settings through the canonical test operation", async () => {
    const service = createTestEditorProductService(platform);
    const document = {
      appMapId: "store",
      appName: "Store",
      revision: 3,
      test: {
        ...test,
        originApplication: "com.example.original",
        nativeRouteCompanions: [
          {
            platform: "android" as const,
            appMapId: "grok-android",
            testId: "test-grok-android-home-chrome",
          },
        ],
        steps: [
          {
            id: "tap",
            kind: "instruction" as const,
            intent: "Tap checkout",
            binding: { status: "unresolved" as const, reason: "Choose a binding" },
          },
        ],
      },
      history: [],
      repairs: [],
    };
    clientRef.current.invoke.mockResolvedValueOnce({
      appMap: {
        ...map(4, "Checkout renamed"),
        tests: {
          checkout: {
            ...document.test,
            name: "Checkout renamed",
            originApplication: "com.example.updated",
          },
        },
      },
    });

    const saved = await service.saveSettings!({
      document,
      name: " Checkout renamed",
      originApplication: " com.example.updated",
    });

    expect(saved.test).toMatchObject({
      id: "checkout",
      name: "Checkout renamed",
      originApplication: "com.example.updated",
      steps: document.test.steps,
    });
    expect(clientRef.current.invoke).toHaveBeenLastCalledWith("app-map.test.save", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: 3,
      test: {
        kind: document.test.kind,
        intentSchemaVersion: document.test.intentSchemaVersion,
        steps: document.test.steps,
        nativeRouteCompanions: document.test.nativeRouteCompanions,
        name: "Checkout renamed",
        originApplication: "com.example.updated",
      },
    });
  });

  it("names Android offline as a compile-block on the editor document", async () => {
    const service = createTestEditorProductService(platform);
    clientRef.current.invoke.mockResolvedValueOnce({
      appMaps: [
        {
          id: "android-primitives",
          name: "Android primitives",
          revision: 34,
          tests: {
            "test-android-browser-offline": {
              id: "test-android-browser-offline",
              organizationId: "local",
              projectId: "default",
              appMapId: "android-primitives",
              createdAt: 1,
              updatedAt: 1,
              name: "Browser mid-run offline",
              kind: "scenario",
              intentSchemaVersion: 1,
              steps: [
                {
                  id: "browser-offline",
                  kind: "instruction",
                  intent: "Toggle browser offline on then off",
                  binding: {
                    status: "resolved",
                    kind: "connections",
                    connectionIds: ["connection-android-browser-offline"],
                  },
                },
              ],
            },
          },
          screens: {
            home: { variantIds: ["android-home"] },
          },
          screenVariants: {
            "android-home": { targetProfile: { platform: "android" } },
          },
          connections: {
            "connection-android-browser-offline": {
              fromScreenId: "home",
              destination: { kind: "end" },
              actions: [
                {
                  kind: "steps",
                  steps: [
                    { kind: "wait-for", target: { label: "Google search" } },
                    { kind: "offline", state: "on" },
                  ],
                },
              ],
            },
          },
          activity: {},
          proposals: {},
        },
      ],
    });

    const document = await service.get("test-android-browser-offline");
    expect(document?.recordedPlatforms).toEqual(["android"]);
    expect(document?.stepPlatformBlockers).toEqual({
      "browser-offline": "offline is a browser step",
    });
  });

  it("names iOS upload as a Files-app compile-block on the editor document", async () => {
    const service = createTestEditorProductService(platform);
    clientRef.current.invoke.mockResolvedValueOnce({
      appMaps: [
        {
          id: "ios-primitives",
          name: "iOS primitives",
          revision: 1,
          tests: {
            "test-ios-upload-pdf": {
              id: "test-ios-upload-pdf",
              organizationId: "local",
              projectId: "default",
              appMapId: "ios-primitives",
              createdAt: 1,
              updatedAt: 1,
              name: "Upload a PDF",
              kind: "scenario",
              intentSchemaVersion: 1,
              steps: [
                {
                  id: "upload-pdf",
                  kind: "instruction",
                  intent: "Upload a PDF",
                  binding: {
                    status: "resolved",
                    kind: "connections",
                    connectionIds: ["connection-ios-upload"],
                  },
                },
              ],
            },
          },
          screens: {
            home: { variantIds: ["ios-home"] },
          },
          screenVariants: {
            "ios-home": { targetProfile: { platform: "ios" } },
          },
          connections: {
            "connection-ios-upload": {
              fromScreenId: "home",
              destination: { kind: "end" },
              actions: [
                {
                  kind: "steps",
                  steps: [{ kind: "upload", file: "tests/fixtures/sample.pdf" }],
                },
              ],
            },
          },
          activity: {},
          proposals: {},
        },
      ],
    });

    const document = await service.get("test-ios-upload-pdf");
    expect(document?.recordedPlatforms).toEqual(["ios"]);
    expect(document?.stepPlatformBlockers).toEqual({
      "upload-pdf":
        "upload on iOS requires a reviewed Files-app handoff; disable this step or record that path",
    });
  });
});

describe("manual test drafts", () => {
  it("saves written actions unresolved through the canonical operation", async () => {
    clientRef.current.invoke.mockReset();
    const current = map(8);
    clientRef.current.invoke
      .mockResolvedValueOnce({ appMap: current })
      .mockImplementationOnce(async (_id, input) => ({
        appMap: {
          ...current,
          revision: 9,
          tests: { ...current.tests, [input.testId]: { ...test, ...input.test, id: input.testId } },
        },
      }));
    const created = await createTestEditorProductService(platform).createDraft!({
      appMapId: "store",
      testId: "manual",
      name: " Video generation ",
      instructions: [" Open Imagine ", "Choose 720p"],
    });
    expect(created.test.name).toBe("Video generation");
    expect(created.test.steps.map((step) => step.intent)).toEqual(["Open Imagine", "Choose 720p"]);
    expect(created.test.steps.every((step) => step.binding.status === "unresolved")).toBe(true);
    expect(
      created.test.steps.every(
        (step) => step.binding.status === "unresolved" && step.binding.fromText === true,
      ),
    ).toBe(true);
    expect(clientRef.current.invoke).toHaveBeenLastCalledWith(
      "app-map.test.save",
      expect.objectContaining({
        appMapId: "store",
        testId: "manual",
        expectedRevision: 8,
        eventId: "create-manual",
      }),
    );
  });
  it("saves drafted Actions and Checks with the start address", async () => {
    clientRef.current.invoke.mockReset();
    const current = map(3);
    clientRef.current.invoke
      .mockResolvedValueOnce({ appMap: current })
      .mockImplementationOnce(async (_id, input) => ({
        appMap: {
          ...current,
          revision: 4,
          tests: { ...current.tests, [input.testId]: { ...test, ...input.test, id: input.testId } },
        },
      }));
    const created = await createTestEditorProductService(platform).createDraft!({
      appMapId: "store",
      testId: "described",
      name: "API keys",
      startUrl: "https://shop.example/",
      steps: [
        { kind: "instruction", intent: "Create an API key" },
        { kind: "validation", intent: "The new key is listed" },
      ],
    });
    expect(created.test.startUrl).toBe("https://shop.example/");
    expect(created.test.steps.map((step) => step.kind)).toEqual(["instruction", "validation"]);
  });
  it("edits only the addressed recorded text through a revisioned connection patch", async () => {
    const current = map(10);
    current.tests.checkout!.steps = [
      {
        id: "type-prompt",
        kind: "instruction",
        intent: "Type text",
        binding: { status: "resolved", kind: "connections", connectionIds: ["prompt"] },
      },
    ];
    current.tests.other = {
      ...test,
      id: "other",
      name: "Other chat",
      steps: structuredClone(current.tests.checkout!.steps),
    };
    const actions = [
      {
        id: "take-action",
        kind: "recorded",
        takeId: "take",
        takeRevision: 12,
        evidenceIds: ["before", "after"],
        steps: [
          { id: "focus", kind: "tap", target: { identifier: "composer" } },
          {
            id: "type-value",
            kind: "type",
            text: "Original prompt",
            mode: "replace",
            target: { identifier: "composer" },
            evidence: { screenshotEvidenceId: "before" },
          },
          { id: "send", kind: "tap", target: { identifier: "send" } },
        ],
      },
      { id: "wait", kind: "wait", ms: 10 },
    ];
    current.connections.prompt = {
      id: "prompt",
      fromScreenId: "home",
      destination: { kind: "end" },
      state: "ready",
      actions,
    } as never;
    const document = documentFromMap(current, "checkout")!;
    const action = document.textActions!["type-prompt"]![0]!;
    expect(action.sharedTestNames).toEqual(["Other chat"]);
    expect(action.recipeStepId).toBe("type-value");
    const next = structuredClone(current);
    next.revision = 11;
    clientRef.current.invoke.mockReset();
    clientRef.current.invoke
      .mockResolvedValueOnce({ appMap: current })
      .mockResolvedValueOnce({ appMap: next });
    await createTestEditorProductService(platform).saveText!({
      document,
      stepId: "type-prompt",
      action,
      text: "{{chat_prompt}}",
    });
    const expected = structuredClone(actions);
    (expected[0]!.steps![1]! as { text: string }).text = "{{chat_prompt}}";
    expect(clientRef.current.invoke).toHaveBeenLastCalledWith("app-map.connection.update", {
      appMapId: "store",
      connectionId: "prompt",
      expectedRevision: 10,
      patch: { actions: expected },
    });
    expect(current.connections.prompt.actions).toEqual(actions);
    clientRef.current.invoke.mockReset();
    clientRef.current.invoke.mockResolvedValue({ appMap: { ...current, revision: 12 } });
    await expect(
      createTestEditorProductService(platform).saveText!({
        document,
        stepId: "type-prompt",
        action,
        text: "new",
      }),
    ).rejects.toThrow("saved test changed");
    expect(clientRef.current.invoke).toHaveBeenCalledTimes(1);
    clientRef.current.invoke.mockReset();
    const unbound = structuredClone(current);
    unbound.tests.checkout!.steps = [];
    clientRef.current.invoke.mockResolvedValue({ appMap: unbound });
    await expect(
      createTestEditorProductService(platform).saveText!({
        document,
        stepId: "type-prompt",
        action,
        text: "new",
      }),
    ).rejects.toThrow("text action changed");
    expect(clientRef.current.invoke).toHaveBeenCalledTimes(1);
  });
});
