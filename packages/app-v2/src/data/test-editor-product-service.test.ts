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
});
