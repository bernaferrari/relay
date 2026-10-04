import { RecordingInputNotSentError } from "./recording-input-outcome";
import { describe, expect, it, vi } from "vitest";
import type { AuthoringInteraction, AuthoringRecordingEdit } from "@relay/protocol";
import type { ProductRecordingState } from "./recording-product-service";
import {
  createRecordingEditAdapter,
  createRecordingProductService,
} from "./recording-product-service";

const journeyEdit = vi.hoisted(() => vi.fn());
const journey = vi.hoisted(() => ({ edit: journeyEdit, record: vi.fn() }));
const client = vi.hoisted(() => ({ invoke: vi.fn(), binaryResource: vi.fn() }));
const listDrafts = vi.hoisted(() => vi.fn());

vi.mock("./product-client", () => ({
  productClientForPlatform: vi.fn(async () => ({ client, actorId: "human:recording-test" })),
}));

vi.mock("@relay/product/recording-journey", () => ({
  createProductRecordingJourneyFromClient: vi.fn(() => journey),
  listProductRecordingDrafts: listDrafts,
}));

const state = { status: "reviewing", targets: [] } as ProductRecordingState;
const interaction = { kind: "screenshot", label: "Language settings" } as const;
const platform = { platform: "web", storage: {} } as never;

describe("recording edit adapter", () => {
  it("lists the same locally saved review name without changing canonical handles", async () => {
    const draft = {
      workflowId: "workflow-draft",
      appMapId: "app-1",
      name: "Untitled recording",
      stepCount: 1,
      updatedAt: 42,
    };
    listDrafts.mockResolvedValueOnce([draft]);
    const get = vi.fn(() => "My unfinished path");
    const service = createRecordingProductService({ platform: "web", storage: { get } } as never);

    await expect(service.listDrafts!()).resolves.toEqual([
      { ...draft, name: "My unfinished path" },
    ]);
    expect(get).toHaveBeenCalledWith("recordingName:workflow-draft");
    expect(listDrafts).toHaveBeenLastCalledWith({ client, actorId: "human:recording-test" });
  });

  it("retains the canonical draft name if local storage is unavailable", async () => {
    const draft = {
      workflowId: "workflow-draft",
      appMapId: "app-1",
      name: "Member path",
      stepCount: 1,
      updatedAt: 42,
    };
    listDrafts.mockResolvedValueOnce([draft]);
    const get = vi.fn(() => {
      throw new Error("Storage unavailable");
    });
    const service = createRecordingProductService({ platform: "web", storage: { get } } as never);

    await expect(service.listDrafts!()).resolves.toEqual([draft]);
  });

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
      `/authoring-evidence/${sha256}?mime=image%2Fpng&v=cors-v2`,
    );
  });

  it("loads only the exact failed replay entrance screenshot in the current revision", async () => {
    const hash = "e".repeat(64);
    const replay = {
      takeRevision: 2,
      outcome: "failed",
      evidence: [{ id: "failure-frame", kind: "screenshot", uri: `relay-evidence://${hash}` }],
      observations: [
        {
          id: "entrance",
          evidenceIds: ["failure-frame"],
          nodes: [{ label: "Search", rect: { x: 40, y: 200, width: 80, height: 40 } }],
        },
      ],
      actionProofs: {
        failed: {
          actionId: "failed",
          outcome: "failed",
          entranceObservationId: "entrance",
          evidenceIds: ["failure-frame"],
        },
      },
    };
    const take = {
      currentRevision: 2,
      revisions: [
        {
          revision: 2,
          actions: [
            { id: "earlier", evidenceIds: [] },
            { id: "failed", evidenceIds: [] },
          ],
          evidence: [],
        },
      ],
      replayAttempts: [replay],
    };
    client.invoke.mockClear();
    client.binaryResource.mockClear();
    client.invoke.mockResolvedValueOnce({ session: { take } });
    client.binaryResource.mockResolvedValueOnce({
      bytes: new Uint8Array([4]),
      headers: new Headers({ "content-type": "image/png" }),
    });
    const service = createRecordingProductService(platform);
    const preview = await service.getEvidencePreview("session", "failure-frame");
    expect(preview?.bytes).toEqual(new Uint8Array([4]));
    expect(preview?.controls?.map((control) => control.name)).toEqual(["Search"]);
    expect(client.binaryResource).toHaveBeenCalledWith(
      `/authoring-evidence/${hash}?mime=image%2Fpng&v=cors-v2`,
    );
    for (const change of [
      (value: typeof replay) => {
        value.takeRevision = 1;
      },
      (value: typeof replay) => {
        value.outcome = "passed";
      },
      (value: typeof replay) => {
        value.actionProofs.failed.outcome = "passed";
      },
      (value: typeof replay) => {
        value.actionProofs.failed.actionId = "earlier";
      },
      (value: typeof replay) => {
        value.actionProofs.failed.entranceObservationId = "missing";
      },
      (value: typeof replay) => {
        value.evidence[0]!.uri = "/private/raw.png";
      },
    ]) {
      const changed = structuredClone(replay);
      change(changed);
      client.invoke.mockResolvedValueOnce({
        session: { take: { ...take, replayAttempts: [changed] } },
      });
      client.binaryResource.mockClear();
      await expect(service.getEvidencePreview("session", "failure-frame")).resolves.toBeNull();
      expect(client.binaryResource).not.toHaveBeenCalled();
    }
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
        id: "com.app:id/language:0",
        name: "Language",
        rect: { x: 40, y: 200, width: 280, height: 56 },
        target: { identifier: "com.app:id/language" },
        why: "Matched the stable identifier com.app:id/language.",
      },
    ]);
  });

  it("decodes legacy full-page evidence and maps merged controls to an accepted frame", async () => {
    const frame = "d".repeat(64);
    const diagnostic = "e".repeat(64);
    const extra = "1".repeat(64);
    const tree = "f".repeat(64);
    client.invoke.mockClear();
    client.binaryResource.mockReset();
    client.invoke.mockResolvedValueOnce({
      session: {
        take: {
          currentRevision: 1,
          revisions: [
            {
              revision: 1,
              evidence: [
                { id: "frame", kind: "screenshot", uri: `relay-evidence://${frame}` },
                { id: "diag", kind: "screenshot", uri: `relay-evidence://${diagnostic}` },
                { id: "extra", kind: "screenshot", uri: `relay-evidence://${extra}` },
                { id: "full-page-tree", kind: "snapshot", uri: `relay-evidence://${tree}` },
              ],
              actions: [
                {
                  id: "capture",
                  evidenceIds: ["frame", "diag", "extra", "full-page-tree"],
                  steps: [{ kind: "screenshot", fullPage: true }],
                },
              ],
            },
          ],
        },
      },
    });
    client.binaryResource
      .mockResolvedValueOnce({
        bytes: new TextEncoder().encode(
          JSON.stringify({
            kind: "full-page-capture",
            status: "stopped",
            reason: "seam-ambiguous",
            message: "Review frames.",
            frames: [
              { index: 0, offsetY: 0, snapshot: {} },
              { index: 1, offsetY: 1000, snapshot: {} },
            ],
            mergedNodes: [
              {
                identifier: "app:continue",
                label: "Continue",
                rect: { x: 10, y: 1100, width: 100, height: 40 },
              },
            ],
          }),
        ),
        headers: new Headers({ "content-type": "application/json" }),
      })
      .mockResolvedValueOnce({
        bytes: new Uint8Array([1]),
        headers: new Headers({ "content-type": "image/png" }),
      });
    const preview = await createRecordingProductService(platform).getEvidencePreview(
      "session-1",
      "frame",
    );
    expect(preview?.fullPage?.diagnosticFrames[0]?.evidenceId).toBe("extra");
    expect(preview?.controls?.[0]?.rect.y).toBe(1100);
    expect(preview?.fullPage?.frames[1]?.evidenceId).toBe("diag");
  });

  it("does not project controls for a diagnostic full-page raster", async () => {
    const shot = "2".repeat(64);
    client.invoke.mockReset();
    client.binaryResource.mockReset();
    client.invoke.mockResolvedValueOnce({
      session: {
        take: {
          currentRevision: 1,
          revisions: [
            {
              revision: 1,
              evidence: [
                { id: "accepted", kind: "screenshot", uri: `relay-evidence://${shot}` },
                { id: "diagnostic", kind: "screenshot", uri: `relay-evidence://${"3".repeat(64)}` },
                { id: "tree", kind: "snapshot", uri: `relay-evidence://${"4".repeat(64)}` },
              ],
              actions: [
                {
                  id: "capture",
                  evidenceIds: ["accepted", "diagnostic", "tree"],
                  fullPage: {
                    status: "stopped",
                    reason: "seam-ambiguous",
                    message: "Review frames.",
                    frames: [{ index: 0, offsetY: 0, evidenceId: "accepted" }],
                    diagnosticFrames: [{ index: 1, offsetY: 100, evidenceId: "diagnostic" }],
                    mergedNodes: [],
                  },
                },
              ],
            },
          ],
        },
      },
    });
    client.binaryResource.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      headers: new Headers({ "content-type": "image/png" }),
    });
    const preview = await createRecordingProductService(platform).getEvidencePreview(
      "session-1",
      "diagnostic",
    );
    expect(preview?.controls).toEqual([]);
  });

  it("keeps screenshot preview usable when a legacy full-page snapshot is unavailable", async () => {
    const screenshot = "5".repeat(64);
    client.invoke.mockReset();
    client.binaryResource.mockReset();
    client.invoke.mockResolvedValueOnce({
      session: {
        take: {
          currentRevision: 1,
          revisions: [
            {
              revision: 1,
              evidence: [
                { id: "shot", kind: "screenshot", uri: `relay-evidence://${screenshot}` },
                { id: "tree", kind: "snapshot", uri: `relay-evidence://${"6".repeat(64)}` },
              ],
              actions: [
                {
                  id: "capture",
                  evidenceIds: ["shot", "tree"],
                  steps: [{ kind: "screenshot", fullPage: true }],
                },
              ],
            },
          ],
        },
      },
    });
    client.binaryResource.mockRejectedValueOnce(new Error("missing"));
    client.binaryResource.mockResolvedValueOnce({
      bytes: new Uint8Array([2]),
      headers: new Headers({ "content-type": "image/png" }),
    });
    await expect(
      createRecordingProductService(platform).getEvidencePreview("session-1", "shot"),
    ).resolves.toMatchObject({ bytes: new Uint8Array([2]) });
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

  it("describes a locked screen as missing accessibility names, not TalkBack audio", async () => {
    client.invoke.mockClear();
    client.invoke.mockResolvedValueOnce({
      inspectable: false,
      inspectionState: "keyguard",
      nodes: [],
    });
    const service = createRecordingProductService(platform);
    const result = await service.reviewTalkBack!("pixel-1");
    expect(result.inspectable).toBe(false);
    expect(result.message).toMatch(/accessibility names/i);
    expect(result.message).not.toMatch(/TalkBack/i);
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

it("live recording preserves only typed pre-dispatch recovery", async () => {
  const service = createRecordingProductService(platform);
  const live = await service.liveTarget!({
    kind: "device",
    platform: "android",
    targetId: "emulator-test",
  });
  journey.record.mockResolvedValue({
    recovery: {
      code: "input-not-dispatched",
      detail: "Inspection failed before tapping",
      recovery: "Reconnect",
    },
  });
  await expect(live.input({ kind: "tap", target: { label: "Continue" } })).rejects.toBeInstanceOf(
    RecordingInputNotSentError,
  );
  journey.record.mockResolvedValue({
    recovery: {
      code: "mutation-outcome-unknown",
      detail: "Inspection failed after tapping",
      recovery: "Inspect",
      recordingMutation: {
        mutationId: "recording-1",
        workflowId: "workflow-1",
        sessionId: "session-1",
        transitionVersion: 18,
        target: { kind: "browser", platform: "browser", targetId: "browser-1" },
      },
    },
  });
  await expect(
    live.input({ kind: "tap", target: { label: "Continue" } }),
  ).rejects.not.toBeInstanceOf(RecordingInputNotSentError);
  await expect(live.input({ kind: "tap", target: { label: "Continue" } })).rejects.toMatchObject({
    recordingMutation: { workflowId: "workflow-1", sessionId: "session-1", transitionVersion: 18 },
  });
  await live.close();
});
