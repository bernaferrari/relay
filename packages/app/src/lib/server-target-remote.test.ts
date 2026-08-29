import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeDevice,
  captureBrowserDeviceFrame,
  controlBrowserDevice,
  inspectBrowserDevice,
  listAndroidDevicesFast,
  listDevices,
  listTargets,
  openBrowserTarget,
  openBrowserDevice,
  preflightTarget,
} from "./server-target-remote";
import { compileBrowserEnvironment } from "@relay/protocol";

test("keeps target operations behind typed endpoints", async () => {
  const calls: string[] = [];
  const client = {
    invoke: async <T>(id: string, input: Record<string, unknown>): Promise<T> => {
      calls.push(`${id} ${JSON.stringify(input)}`);
      if (id === "target.devices.list") {
        return {
          devices: [
            {
              id: input.phase === "android" ? "pixel-fast" : "pixel-1",
              serial: input.phase === "android" ? "pixel-fast" : "pixel-1",
              name: "Pixel",
              kind: "Physical device",
              booted: true,
              platform: "android",
            },
          ],
        } as T;
      }
      if (id === "target.list") return { targets: [] } as T;
      if (id === "target.open") {
        return { session: { targetId: "browser", name: "Web", url: "https://example.test" } } as T;
      }
      return { preflight: { id: "browser", ok: true, checks: [] } } as T;
    },
  };
  assert.equal((await listDevices(client as never))[0]?.serial, "pixel-1");
  assert.equal((await listAndroidDevicesFast(client as never))[0]?.serial, "pixel-fast");
  await listTargets(client as never);
  await authorizeDevice(client as never, { serial: "pixel-1" });
  await preflightTarget(client as never, "browser");
  await openBrowserTarget(client as never, "browser");
  assert.deepEqual(calls, [
    "target.devices.list {}",
    'target.devices.list {"phase":"android"}',
    "target.list {}",
    'target.authorize {"serial":"pixel-1"}',
    'target.preflight {"targetId":"browser"}',
    'target.open {"targetId":"browser"}',
  ]);
});

test("Browser Device transport keeps frame provenance on every mutation", async () => {
  const calls: string[] = [];
  const profile = compileBrowserEnvironment({ viewport: { width: 800, height: 600 } });
  const session = {
    schemaVersion: 1 as const,
    sessionId: "session-1",
    targetId: "browser",
    status: "streaming" as const,
    ownership: "controlled" as const,
    sequence: 3,
    activePageId: "page-1",
    pages: [],
    profile,
    startedAt: 1,
  };
  const client = {
    invoke: async <T>(id: string, input: Record<string, unknown>): Promise<T> => {
      calls.push(`${id} ${JSON.stringify(input)}`);
      if (id === "target.browser-device.frame") {
        return {
          session,
          frame: {
            sessionId: session.sessionId,
            sequence: 3,
            pageId: "page-1",
            pageUrl: "https://example.test/",
            visualFingerprint: "frame-digest",
            capturedAt: 2,
            mime: "image/jpeg",
            base64: "AA==",
            bytes: 1,
            width: 800,
            height: 600,
          },
        } as T;
      }
      if (id === "target.browser-device.control") return { ok: true, session } as T;
      return { session } as T;
    },
  };
  await openBrowserDevice(client as never, { targetId: "browser" });
  await captureBrowserDeviceFrame(client as never, "browser", 2);
  await inspectBrowserDevice(client as never, "browser", {
    sessionId: "session-1",
    pageId: "page-1",
    expectedSequence: 3,
  });
  await controlBrowserDevice(client as never, "browser", {
    sessionId: "session-1",
    pageId: "page-1",
    expectedSequence: 3,
    kind: "click",
    x: 10,
    y: 20,
  });
  assert.deepEqual(calls, [
    'target.browser-device.open {"targetId":"browser"}',
    'target.browser-device.frame {"targetId":"browser","afterSequence":2}',
    'target.browser-device.inspect {"targetId":"browser","sessionId":"session-1","pageId":"page-1","expectedSequence":3}',
    'target.browser-device.control {"targetId":"browser","input":{"sessionId":"session-1","pageId":"page-1","expectedSequence":3,"kind":"click","x":10,"y":20}}',
  ]);
});

test("Browser Device binary transport reconstructs exact frame metadata and bytes", async () => {
  const profile = compileBrowserEnvironment({ viewport: { width: 800, height: 600 } });
  const session = {
    schemaVersion: 1 as const,
    sessionId: "session-binary",
    targetId: "browser",
    status: "streaming" as const,
    ownership: "controlled" as const,
    sequence: 7,
    activePageId: "page-binary",
    pages: [],
    profile,
    startedAt: 1,
  };
  const metadata = {
    schemaVersion: 1 as const,
    transport: "binary" as const,
    session,
    frame: {
      sessionId: session.sessionId,
      sequence: 7,
      pageId: session.activePageId,
      pageUrl: "https://example.test/",
      visualFingerprint: "binary-digest",
      capturedAt: 8,
      mime: "image/jpeg" as const,
      bytes: 3,
      width: 800,
      height: 600,
    },
    gap: { afterSequence: 2, currentSequence: 7, dropped: 4 },
  };
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const envelope = new Uint8Array(4 + metadataBytes.byteLength + 3);
  new DataView(envelope.buffer).setUint32(0, metadataBytes.byteLength);
  envelope.set(metadataBytes, 4);
  envelope.set([1, 2, 3], 4 + metadataBytes.byteLength);
  const calls: string[] = [];
  const client = {
    binaryResource: async (path: string) => {
      calls.push(`binary ${path}`);
      return {
        bytes: envelope,
        headers: new Headers({
          "x-relay-browser-device-transport": "binary",
          "content-type": "application/x-relay-browser-device-frame",
        }),
      };
    },
    invoke: async <T>(id: string, input: Record<string, unknown>): Promise<T> => {
      calls.push(`${id} ${JSON.stringify(input)}`);
      throw new Error("JSON fallback should not be used");
    },
  };

  const result = await captureBrowserDeviceFrame(client as never, "browser", 2);
  assert.equal(result.transport, "binary");
  assert.deepEqual(result.session, session);
  assert.equal(result.frame.sessionId, "session-binary");
  assert.equal(result.frame.pageId, "page-binary");
  assert.equal(result.frame.sequence, 7);
  assert.equal(result.frame.visualFingerprint, "binary-digest");
  assert.equal(result.frame.base64, "AQID");
  assert.deepEqual(result.gap, metadata.gap);
  assert.deepEqual(calls, ["binary /targets/browser/browser-device/frame.bin?afterSequence=2"]);
});

test("Browser Device binary transport falls back only when the resource is unsupported", async () => {
  const calls: string[] = [];
  const client = {
    binaryResource: async () => {
      calls.push("binary");
      const error = new Error("not found") as Error & { status: number };
      error.status = 404;
      throw error;
    },
    invoke: async <T>(id: string, input: Record<string, unknown>): Promise<T> => {
      calls.push(`${id} ${JSON.stringify(input)}`);
      return {
        session: {},
        frame: {},
      } as T;
    },
  };

  const result = await captureBrowserDeviceFrame(client as never, "browser", 4);
  assert.equal(result.transport, "json-fallback");
  assert.deepEqual(calls, [
    "binary",
    'target.browser-device.frame {"targetId":"browser","afterSequence":4}',
  ]);
});

test("Browser Device binary transport fails closed on malformed supported resources", async () => {
  let jsonFallback = false;
  const client = {
    binaryResource: async () => ({
      bytes: new Uint8Array([0, 0, 0, 0]),
      headers: new Headers({
        "x-relay-browser-device-transport": "binary",
        "content-type": "application/x-relay-browser-device-frame",
      }),
    }),
    invoke: async () => {
      jsonFallback = true;
      throw new Error("must not fall back after a malformed binary response");
    },
  };

  await assert.rejects(
    () => captureBrowserDeviceFrame(client as never, "browser"),
    /Binary Browser Device frame metadata is not valid JSON/,
  );
  assert.equal(jsonFallback, false);
});
