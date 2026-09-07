import { describe, expect, it, vi } from "vitest";
import type { AuthoringInteraction, AuthoringRecordingEdit } from "@relay/protocol";
import type { ProductRecordingState } from "./recording-product-service";
import {
  createRecordingEditAdapter,
  createRecordingProductService,
} from "./recording-product-service";

const journeyEdit = vi.hoisted(() => vi.fn());
const journey = vi.hoisted(() => ({ edit: journeyEdit }));
const client = vi.hoisted(() => ({ invoke: vi.fn(), binaryResource: vi.fn() }));

vi.mock("./product-client", () => ({
  productClientForPlatform: vi.fn(async () => ({ client, actorId: "human:recording-test" })),
}));

vi.mock("@relay/product/recording-journey", () => ({
  createProductRecordingJourneyFromClient: vi.fn(() => journey),
}));

const state = { status: "reviewing", targets: [] } as ProductRecordingState;
const interaction = { kind: "screenshot", label: "Language settings" } as const;
const platform = { platform: "web", storage: {} } as never;

describe("recording edit adapter", () => {
  it("maps each named edit to the canonical protocol union", async () => {
    const edits: AuthoringRecordingEdit[] = [];
    const adapter = createRecordingEditAdapter({
      edit: async (edit) => {
        edits.push(edit);
        return state;
      },
    });
    const actionIds = ["open-settings", "choose-language"];

    await adapter.clip(100, 900);
    await adapter.clip(undefined, 900);
    await adapter.restore(3);
    await adapter.remove(actionIds);
    await adapter.reorder(actionIds);
    await adapter.replace("open-settings", interaction);
    await adapter.merge(actionIds, "Open settings and choose a language");
    await adapter.split("open-settings", 2);
    await adapter.rename("open-settings", "Open settings");

    expect(edits).toEqual([
      { kind: "clip", fromMs: 100, toMs: 900 },
      { kind: "clip", toMs: 900 },
      { kind: "restore", sourceRevision: 3 },
      { kind: "remove", actionIds },
      { kind: "reorder", actionIds },
      { kind: "replace", actionId: "open-settings", interaction },
      {
        kind: "merge",
        actionIds,
        intent: "Open settings and choose a language",
      },
      { kind: "split", actionId: "open-settings", atStep: 2 },
      { kind: "rename", actionId: "open-settings", intent: "Open settings" },
    ]);
  });

  it("clones readonly action IDs before passing them to the edit transport", async () => {
    let received: AuthoringRecordingEdit | undefined;
    const adapter = createRecordingEditAdapter({
      edit: async (edit) => {
        received = edit;
        return state;
      },
    });
    const actionIds: string[] = ["first"];

    await adapter.remove(actionIds);
    actionIds.push("later");

    expect(received).toEqual({ kind: "remove", actionIds: ["first"] });
  });

  it("exposes the named operations on the concrete platform service", async () => {
    journeyEdit.mockClear();
    journeyEdit.mockResolvedValue(state);
    const service = createRecordingProductService(platform);

    await service.clip(100, 900);
    await service.restore(3);
    await service.rename("action-1", "Open settings");
    await service.merge(["action-1", "action-2"]);

    expect(journeyEdit).toHaveBeenNthCalledWith(1, {
      kind: "clip",
      fromMs: 100,
      toMs: 900,
    });
    expect(journeyEdit).toHaveBeenNthCalledWith(2, {
      kind: "restore",
      sourceRevision: 3,
    });
    expect(journeyEdit).toHaveBeenNthCalledWith(3, {
      kind: "rename",
      actionId: "action-1",
      intent: "Open settings",
    });
    expect(journeyEdit).toHaveBeenNthCalledWith(4, {
      kind: "merge",
      actionIds: ["action-1", "action-2"],
    });
  });

  it("fetches the review-only optimization proposal by authoring session", async () => {
    client.invoke.mockClear();
    client.invoke.mockResolvedValueOnce({ proposal: null });
    const service = createRecordingProductService(platform);

    await expect(service.getOptimization("session-optimization")).resolves.toEqual({
      proposal: null,
    });
    expect(client.invoke).toHaveBeenCalledWith("authoring.take.optimization.get", {
      sessionId: "session-optimization",
    });
  });

  it("returns only an authenticated screenshot preview from the current revision", async () => {
    const sha256 = "a".repeat(64);
    client.invoke.mockClear();
    client.binaryResource.mockClear();
    client.invoke.mockResolvedValueOnce({
      session: {
        take: {
          currentRevision: 2,
          revisions: [
            { revision: 1, evidence: [] },
            {
              revision: 2,
              evidence: [
                {
                  id: "screenshot-1",
                  kind: "screenshot",
                  uri: `relay-evidence://${sha256}`,
                  mime: "image/png",
                },
              ],
            },
          ],
        },
      },
    });
    client.binaryResource.mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      headers: new Headers({ "content-type": "image/png" }),
    });
    const service = createRecordingProductService(platform);

    await expect(service.getEvidencePreview("session-1", "screenshot-1")).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/png",
    });
    expect(client.binaryResource).toHaveBeenCalledWith(
      `/authoring-evidence/${sha256}?mime=image%2Fpng`,
    );
  });

  it("projects pickable controls from the observation that owns the screenshot", async () => {
    const sha256 = "b".repeat(64);
    client.invoke.mockClear();
    client.binaryResource.mockClear();
    client.invoke.mockResolvedValueOnce({
      session: {
        take: {
          currentRevision: 1,
          revisions: [
            {
              revision: 1,
              evidence: [
                {
                  id: "screenshot-lang",
                  kind: "screenshot",
                  uri: `relay-evidence://${sha256}`,
                  mime: "image/png",
                },
              ],
              observations: [
                {
                  evidenceIds: ["screenshot-lang"],
                  nodes: [
                    {
                      identifier: "com.app:id/language",
                      label: "Language",
                      rect: { x: 40, y: 200, width: 280, height: 56 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    client.binaryResource.mockResolvedValueOnce({
      bytes: new Uint8Array([9]),
      headers: new Headers({ "content-type": "image/png" }),
    });
    const preview = await createRecordingProductService(platform).getEvidencePreview(
      "session-1",
      "screenshot-lang",
    );
    expect(preview?.controls).toEqual([
      {
        id: "com.app:id/language",
        name: "Language",
        rect: { x: 40, y: 200, width: 280, height: 56 },
        target: { identifier: "com.app:id/language" },
        why: "Matched the stable identifier com.app:id/language.",
      },
    ]);
  });

  it("projects TalkBack names from a live Android snapshot without enabling audio", async () => {
    client.invoke.mockClear();
    client.invoke.mockResolvedValueOnce({
      inspectable: true,
      nodes: [
        {
          description: "Close",
          role: "android.widget.ImageButton",
          hittable: true,
          rect: { x: 8, y: 8, width: 48, height: 48 },
          index: 0,
        },
        {
          role: "android.widget.ImageButton",
          hittable: true,
          identifier: "app:id/more",
          rect: { x: 60, y: 8, width: 48, height: 48 },
          index: 1,
        },
      ],
    });
    const service = createRecordingProductService(platform);
    const result = await service.reviewTalkBack!("pixel-1");
    expect(client.invoke).toHaveBeenCalledWith("target.snapshot.capture", {
      serial: "pixel-1",
      full: true,
    });
    expect(result.inspectable).toBe(true);
    expect(result.review.items[0]?.announcement).toBe("Close, Button");
    expect(result.review.errorCount).toBe(1);
    expect(result.review.issues[0]?.issues[0]?.code).toBe("icon-without-name");
  });

  it("returns the server health and observation from reconcile, not only the request", async () => {
    client.invoke.mockClear();
    client.invoke.mockResolvedValueOnce({
      health: {
        input: { state: "uncertain", pendingMutationId: "mut-1", reason: "Still ambiguous" },
      },
      observation: { schemaVersion: 1, capturedAt: 9 },
    });
    const service = createRecordingProductService(platform);
    await expect(
      service.reconcileInput!({
        serial: "pixel-1",
        mutationId: "mut-1",
        outcome: "not-applied",
      }),
    ).resolves.toEqual({
      mutationId: "mut-1",
      outcome: "ambiguous",
      health: { state: "uncertain", pendingMutationId: "mut-1", reason: "Still ambiguous" },
      observation: { schemaVersion: 1, capturedAt: 9 },
    });
  });

  it("retrieves a stored reconcile receipt without inventing an effect", async () => {
    client.invoke.mockClear();
    client.invoke.mockResolvedValueOnce({
      receipt: {
        resolutionId: "res-9",
        mutationId: "mut-9",
        outcome: "not-applied",
        reviewedAt: 12,
        health: { state: "ready" },
      },
    });
    const service = createRecordingProductService(platform);
    await expect(
      service.fetchReconcileReceipt!({ serial: "pixel-1", mutationId: "mut-9" }),
    ).resolves.toEqual({
      mutationId: "mut-9",
      resolutionId: "res-9",
      outcome: "not-applied",
      health: { state: "ready" },
    });
    expect(client.invoke).toHaveBeenCalledWith("target.input.receipt.get", {
      serial: "pixel-1",
      mutationId: "mut-9",
    });
  });

  it("does not invent applied from ready when the server omits an outcome", async () => {
    client.invoke.mockClear();
    client.invoke.mockResolvedValueOnce({
      health: { input: { state: "ready" } },
    });
    const service = createRecordingProductService(platform);
    await expect(
      service.reconcileInput!({
        serial: "pixel-1",
        mutationId: "mut-3",
        outcome: "applied",
      }),
    ).resolves.toMatchObject({
      mutationId: "mut-3",
      outcome: "ambiguous",
      health: { state: "ready" },
    });
  });

  it("keeps a not-applied observation when the fence is ready", async () => {
    client.invoke.mockClear();
    client.invoke.mockResolvedValueOnce({
      outcome: "not-applied",
      health: { input: { state: "ready" } },
    });
    const service = createRecordingProductService(platform);
    await expect(
      service.reconcileInput!({
        serial: "pixel-1",
        mutationId: "mut-2",
        outcome: "not-applied",
      }),
    ).resolves.toEqual({
      mutationId: "mut-2",
      outcome: "not-applied",
      health: { state: "ready" },
    });
  });
});

// Keep this assertion close to the adapter tests so a future protocol edit
// change cannot silently make the React adapter's interaction input unsafe.
void (interaction satisfies AuthoringInteraction);
