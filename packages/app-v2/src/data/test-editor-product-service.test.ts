import { describe, expect, it, vi } from "vitest";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { createTestEditorProductService } from "./test-editor-product-service";

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
});
