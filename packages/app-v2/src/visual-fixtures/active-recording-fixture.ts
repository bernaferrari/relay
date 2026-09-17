import type { ProductRecordingState } from "@relay/product/recording-journey";
import type { LiveTargetSnapshot, LiveTargetSession } from "../data/live-target-session";

export const activeRecordingTarget = {
  kind: "browser" as const,
  platform: "browser" as const,
  targetId: "checkout-browser",
};

export const activeRecordingState: ProductRecordingState = {
  status: "recording",
  targets: [activeRecordingTarget],
  selectedTarget: activeRecordingTarget,
  snapshot: {
    schemaVersion: 1,
    kind: "author-test",
    title: "Complete checkout and confirm the order",
    phase: "running",
    stage: "recording",
    version: "active-recording-fixture-v1",
    workflow: { workflowId: "recording-active", expectedVersion: 1 },
    frozen: {
      title: "Complete checkout and confirm the order",
      actorId: "human:fixture",
      appMapId: "checkout-app",
      appMapRevision: 4,
      target: activeRecordingTarget,
    },
    authoring: { sessionId: "recording-active" },
    review: {
      actionCount: 1,
      currentRevision: 1,
      revisionCount: 1,
      actions: [
        {
          id: "open-cart",
          intent: "Open the shopping cart",
          stepCount: 1,
          kind: "tap",
          startedAt: Date.UTC(2026, 8, 4, 11, 59),
          finishedAt: Date.UTC(2026, 8, 4, 11, 59, 1),
          durationMs: 1_000,
          evidenceCount: 1,
          proofStatus: "verified",
          captureProof: "relay-controlled",
        },
      ],
      timeline: {
        startedAt: Date.UTC(2026, 8, 4, 11, 59),
        finishedAt: Date.UTC(2026, 8, 4, 12),
        durationMs: 60_000,
        actionCount: 1,
        evidenceCount: 1,
        observationCount: 1,
      },
      replayRequired: false,
    },
    progress: { label: "Recording in progress" },
    allowedNextActions: ["record", "checkpoint", "stop"],
    problems: [],
    evidenceRefs: [],
  },
};

export function createActiveRecordingTarget(): LiveTargetSession {
  const snapshot: LiveTargetSnapshot = {
    status: "streaming",
    target: activeRecordingTarget,
    lastFrameAt: Date.UTC(2026, 8, 4, 12),
  };
  return {
    snapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => undefined;
    },
    mount(canvas) {
      canvas.width = 768;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#f5f6f8";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.fillRect(92, 46, 584, 420);
        context.fillStyle = "#171719";
        context.font = "600 28px system-ui";
        context.fillText("Checkout", 132, 104);
        context.font = "18px system-ui";
        context.fillStyle = "#62636a";
        context.fillText("Order summary", 132, 150);
      }
      return () => undefined;
    },
    input: async () => undefined,
    close: () => undefined,
  };
}
