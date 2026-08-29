import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeDevice,
  captureBrowserDeviceFrame,
  controlBrowserDevice,
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
    'target.browser-device.control {"targetId":"browser","input":{"sessionId":"session-1","pageId":"page-1","expectedSequence":3,"kind":"click","x":10,"y":20}}',
  ]);
});
