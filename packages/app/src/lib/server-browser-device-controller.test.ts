import assert from "node:assert/strict";
import test from "node:test";
import { createSignal } from "solid-js";
import { compileBrowserEnvironment, type BrowserDeviceSession } from "@relay/protocol";
import { createServerBrowserDeviceController } from "./server-browser-device-controller";
import type { Frame } from "./api-types";

function session(targetId: string, status: BrowserDeviceSession["status"] = "streaming") {
  return {
    schemaVersion: 1 as const,
    sessionId: `session-${targetId}`,
    targetId,
    status,
    ownership: "controlled" as const,
    sequence: 1,
    activePageId: `page-${targetId}`,
    pages: [
      {
        id: `page-${targetId}`,
        kind: "page" as const,
        title: targetId,
        url: `https://${targetId}.example/`,
        active: true,
        closed: false,
      },
    ],
    profile: compileBrowserEnvironment({ viewport: { width: 800, height: 600 } }),
    startedAt: 1,
  } satisfies BrowserDeviceSession;
}

function frameFor(targetId: string) {
  return {
    sessionId: `session-${targetId}`,
    sequence: 1,
    pageId: `page-${targetId}`,
    pageUrl: `https://${targetId}.example/`,
    visualFingerprint: `digest-${targetId}`,
    capturedAt: 2,
    mime: "image/jpeg" as const,
    base64: "AA==",
    bytes: 1,
    width: 800,
    height: 600,
  };
}

test("Browser Device drops a late frame after target reset", async () => {
  const [selectedDevice, setSelectedDevice] = createSignal<string | null>("browser-a");
  let resolveFrame!: (value: unknown) => void;
  const deferredFrame = new Promise((resolve) => {
    resolveFrame = resolve;
  });
  const client = {
    invoke: async (operationId: string, input: { targetId: string }) => {
      if (operationId === "target.browser-device.open") {
        return { session: session(input.targetId, "starting") };
      }
      if (operationId === "target.browser-device.frame") return await deferredFrame;
      throw new Error(`unexpected operation: ${operationId}`);
    },
  };
  let liveFrame: Frame | null = null;
  let issue: string | null = null;
  const controller = createServerBrowserDeviceController({
    client: async () => client as never,
    selectedDevice,
    setLiveFrame: (value) => {
      liveFrame = value;
    },
    setLiveCaptureIssue: (value) => {
      issue = value;
    },
  });

  const polling = controller.poll();
  await new Promise((resolve) => setImmediate(resolve));
  setSelectedDevice("browser-b");
  controller.reset();
  resolveFrame({ session: session("browser-a"), frame: frameFor("browser-a") });
  await polling;

  assert.equal(controller.session(), null);
  assert.equal(liveFrame, null);
  assert.equal(issue, null);
});

test("Browser Device clears stale pixels and degrades after capture failure", async () => {
  const [selectedDevice] = createSignal<string | null>("browser-a");
  let liveFrame: Frame | null = {
    id: "old",
    capturedAt: 1,
    mime: "image/jpeg",
    base64: "AA==",
    bytes: 1,
    serial: "browser-a",
    caption: "old browser frame",
  };
  let issue: string | null = null;
  const client = {
    invoke: async (operationId: string, input: { targetId: string }) => {
      if (operationId === "target.browser-device.open") {
        return { session: session(input.targetId, "starting") };
      }
      if (operationId === "target.browser-device.frame") throw new Error("capture stopped");
      throw new Error(`unexpected operation: ${operationId}`);
    },
  };
  const controller = createServerBrowserDeviceController({
    client: async () => client as never,
    selectedDevice,
    setLiveFrame: (value) => {
      liveFrame = value;
    },
    setLiveCaptureIssue: (value) => {
      issue = value;
    },
  });

  await controller.poll();

  assert.equal(liveFrame, null);
  assert.equal(controller.session()?.status, "degraded");
  assert.equal(issue, "capture stopped");
});

test("Browser Device clears semantic labels when a newer frame arrives", async () => {
  const [selectedDevice] = createSignal<string | null>("browser-a");
  let frameCalls = 0;
  const client = {
    invoke: async (operationId: string, input: { targetId: string }) => {
      if (operationId === "target.browser-device.open") {
        return { session: session(input.targetId) };
      }
      if (operationId === "target.browser-device.frame") {
        frameCalls += 1;
        const sequence = frameCalls;
        return {
          session: { ...session(input.targetId), sequence },
          frame: { ...frameFor(input.targetId), sequence, visualFingerprint: `digest-${sequence}` },
        };
      }
      if (operationId === "target.browser-device.inspect") {
        return {
          overlay: {
            schemaVersion: 1,
            sessionId: "session-browser-a",
            pageId: "page-browser-a",
            sequence: 1,
            visualFingerprint: "digest-1",
            capturedAt: 2,
            candidates: [],
            truncated: false,
          },
        };
      }
      throw new Error(`unexpected operation: ${operationId}`);
    },
  };
  const controller = createServerBrowserDeviceController({
    client: async () => client as never,
    selectedDevice,
    setLiveFrame: () => undefined,
    setLiveCaptureIssue: () => undefined,
  });

  await controller.poll();
  assert.equal((await controller.inspect())?.sequence, 1);
  assert.equal(controller.semanticOverlay()?.visualFingerprint, "digest-1");
  await controller.poll();
  assert.equal(controller.semanticOverlay(), null);
});
