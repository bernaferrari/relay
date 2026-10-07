import { describe, expect, it } from "vitest";
import type { DeviceSummary, TargetRuntimeReadiness } from "@relay/protocol";
import { projectDevices } from "./device-product-service";

describe("device product projection", () => {
  it("separates ready, attention, and virtual targets", () => {
    const devices = projectDevices([
      {
        id: "offline",
        serial: "offline",
        name: "Phone",
        kind: "Physical device",
        booted: true,
        platform: "android",
        connectionState: "offline",
      },
      {
        id: "ready",
        serial: "ready",
        name: "iPad",
        kind: "Physical device",
        booted: true,
        platform: "ios",
      },
      {
        id: "browser",
        serial: "browser",
        name: "Chrome",
        kind: "Managed browser",
        booted: null,
        platform: "browser",
      },
      {
        id: "simulator",
        serial: "simulator",
        name: "Pixel simulator",
        kind: "Android emulator",
        booted: true,
        platform: "android",
        connectionState: "connected",
      },
    ]);
    expect(Object.fromEntries(devices.map((device) => [device.id, device.status]))).toEqual({
      browser: "virtual",
      offline: "needs-attention",
      ready: "ready",
      simulator: "virtual",
    });
    expect(devices.find((device) => device.id === "simulator")?.runnable).toBe(true);
    expect(devices.find((device) => device.id === "offline")?.recovery).toMatch(/reconnect/i);
  });
});

it("never advertises a stopped simulator as ready", () => {
  const [device] = projectDevices([
    {
      id: "stopped",
      name: "iPad",
      serial: "stopped",
      platform: "ios",
      kind: "simulator",
      booted: false,
    },
  ]);
  expect(device?.status).toBe("needs-attention");
  expect(device?.runnable).toBe(false);
});

function currentPixelsWithStaleLabels(): DeviceSummary {
  const readiness: TargetRuntimeReadiness = {
    previewPixels: { mode: "pixels", state: "proven", freshness: "current", proof: { at: 200 } },
    evidenceCapture: {
      mode: "evidence",
      state: "proven",
      freshness: "current",
      proof: { at: 200 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "proven",
      freshness: "stale",
      proof: { at: 100 },
      invalidated: { at: 150, reason: "input-changed" },
    },
  };
  return {
    id: "ipad",
    serial: "ipad",
    name: "iPad",
    platform: "ios",
    kind: "Physical device",
    booted: true,
    connectionState: "connected",
    developerMode: "enabled",
    developerServicesAvailable: true,
    readiness,
  };
}

it.each(["input-changed", "visual-changed"] as const)(
  "keeps a pixel-ready iPad usable after %s without claiming current labels",
  (reason) => {
    const summary = currentPixelsWithStaleLabels();
    summary.readiness!.semanticControl.invalidated!.reason = reason;
    const [device] = projectDevices([summary]);
    expect(device).toMatchObject({ status: "ready", runnable: true });
    expect(device.device.readiness).toBe(summary.readiness);
    expect(device.device.readiness?.semanticControl).toMatchObject({
      state: "proven",
      freshness: "stale",
      invalidated: { reason },
    });
  },
);

it.each(["previewPixels", "evidenceCapture"] as const)(
  "does not allow stale labels to bypass missing or unavailable %s proof",
  (capability) => {
    for (const state of ["unproven", "unavailable"] as const) {
      const summary = currentPixelsWithStaleLabels();
      summary.readiness![capability] = {
        mode: capability === "previewPixels" ? "pixels" : "evidence",
        state,
        freshness: "unproven",
      };
      expect(projectDevices([summary])[0]).toMatchObject({
        status: "needs-attention",
        runnable: false,
      });
    }
  },
);

it("keeps unexplained stale labels and stale pixel evidence blocked", () => {
  const unexplained = currentPixelsWithStaleLabels();
  delete unexplained.readiness!.semanticControl.invalidated;
  expect(projectDevices([unexplained])[0].runnable).toBe(false);
  const stalePixels = currentPixelsWithStaleLabels();
  stalePixels.readiness!.previewPixels.freshness = "stale";
  expect(projectDevices([stalePixels])[0].runnable).toBe(false);
});

it.each([
  { connectionState: "disconnected" },
  { connectionState: "locked" },
  { booted: false },
  { developerMode: "disabled" as const },
  { developerServicesAvailable: false },
])("keeps an unavailable native device blocked despite current pixels (%j)", (change) => {
  expect(projectDevices([{ ...currentPixelsWithStaleLabels(), ...change }])[0]).toMatchObject({
    status: "needs-attention",
    runnable: false,
  });
});

it("preserves managed browser readiness policy", () => {
  expect(
    projectDevices([{ ...currentPixelsWithStaleLabels(), platform: "browser" }])[0],
  ).toMatchObject({
    status: "virtual",
    runnable: false,
  });
});
