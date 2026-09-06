import { describe, expect, it } from "vitest";
import {
  classifyInvestigationReproduction,
  investigationConfigRefs,
  investigationReproductionCopy,
  matchOriginalInvestigationDevice,
  originalEnvironmentSummary,
} from "./investigation-environment";

const original = {
  runId: "run-failed",
  targetName: "Ready Pixel",
  targetProfileId: "serial-ready",
  buildId: "build-92",
  browser: "Chrome",
};

const ready = {
  id: "ready",
  serial: "serial-ready",
  name: "Ready Pixel",
  runnable: true,
};
const substitute = {
  id: "lab",
  serial: "serial-lab",
  name: "Lab Pixel",
  runnable: true,
};
const offline = {
  id: "ready",
  serial: "serial-ready",
  name: "Ready Pixel",
  runnable: false,
};

describe("investigation environment restore", () => {
  it("matches the original device by identity, not a duplicate display name", () => {
    expect(
      matchOriginalInvestigationDevice(
        [ready, { id: "twin", serial: "serial-twin", name: "Ready Pixel", runnable: true }],
        original,
      ),
    ).toEqual(ready);
    expect(
      matchOriginalInvestigationDevice(
        [
          { id: "a", serial: "serial-a", name: "Ready Pixel", runnable: true },
          { id: "b", serial: "serial-b", name: "Ready Pixel", runnable: true },
        ],
        { runId: "run-failed", targetName: "Ready Pixel" },
      ),
    ).toBeUndefined();
  });

  it("restores the original configuration only when that exact device is ready", () => {
    const restoring = classifyInvestigationReproduction({
      original,
      devices: [ready, substitute],
      devicesPending: false,
      selectedSerial: "serial-ready",
    });
    expect(restoring).toEqual({
      kind: "restoring-original",
      original,
      device: ready,
    });
    expect(investigationReproductionCopy(restoring)).toMatchObject({
      title: "Reproduction environment",
      detail: "Restoring original configuration…",
      autoStart: true,
    });
    expect(investigationConfigRefs(original, restoring)).toEqual([
      "targetProfileId:serial-ready",
      "buildId:build-92",
      "browser:Chrome",
      "reproduction:original",
    ]);
  });

  it("labels a missing original device as unavailable and does not auto-start", () => {
    const unavailable = classifyInvestigationReproduction({
      original,
      devices: [offline, substitute],
      devicesPending: false,
      selectedSerial: "",
    });
    expect(unavailable.kind).toBe("original-unavailable");
    expect(investigationReproductionCopy(unavailable)).toMatchObject({
      title: "Original device unavailable",
      autoStart: false,
    });
    expect(originalEnvironmentSummary(original)).toBe("Ready Pixel · Chrome · Build build-92");
  });

  it("treats a different ready device as a new experiment, not a reproduction", () => {
    const substituted = classifyInvestigationReproduction({
      original,
      devices: [offline, substitute],
      devicesPending: false,
      selectedSerial: "serial-lab",
    });
    expect(substituted).toEqual({
      kind: "substituted",
      original,
      device: substitute,
      reason: "original-unavailable",
    });
    expect(investigationReproductionCopy(substituted)).toEqual({
      title: "Investigating on Lab Pixel instead",
      detail: "This is a new experiment. The original result stays unchanged.",
      startLabel: "Start new experiment",
      autoStart: false,
    });
    expect(investigationConfigRefs(original, substituted)).toContain("reproduction:substituted");
    expect(investigationConfigRefs(original, substituted)).not.toContain("reproduction:original");
  });

  it("waits while devices resolve instead of guessing a substitute", () => {
    expect(
      classifyInvestigationReproduction({
        original,
        devicesPending: true,
        selectedSerial: "",
      }).kind,
    ).toBe("resolving");
  });
});
