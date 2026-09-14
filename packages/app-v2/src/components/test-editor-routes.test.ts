import { describe, expect, it } from "vitest";
import { testRoutePlatformStatuses } from "@relay/product/test-route-platforms";
import { stepReadinessLabel } from "./test-editor-step";

describe("test editor platform routes", () => {
  it("shows Android and iOS as not recorded for a grok.com Test", () => {
    const statuses = testRoutePlatformStatuses({
      originApplication: "https://grok.com/",
    });
    expect(statuses.find((item) => item.platform === "android")?.status).toBe("unrecorded");
    expect(statuses.find((item) => item.platform === "ios")?.reason).toMatch(
      /Do not invent Grok Settings navigation/u,
    );
  });

  it("marks Web recorded from saved browser surfaces when origin is missing", () => {
    const statuses = testRoutePlatformStatuses({}, { recordedPlatforms: ["browser"] });
    expect(statuses.find((item) => item.platform === "browser")?.status).toBe("reviewed");
    expect(statuses.find((item) => item.platform === "android")?.status).toBe("unrecorded");
  });

  it("names Android/iOS as disabled on recorded Web steps", () => {
    expect(
      stepReadinessLabel(
        {
          id: "open",
          kind: "instruction",
          intent: "Open grok.com",
          binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
        },
        { unrecordedNative: true },
      ),
    ).toMatch(/Android\/iOS disabled until recorded/u);
  });
});

describe("disabled steps", () => {
  it("names the disable reason in the step list", () => {
    expect(
      stepReadinessLabel({
        id: "upload",
        kind: "instruction",
        intent: "Upload a file",
        binding: { status: "resolved", kind: "connections", connectionIds: ["upload"] },
        execution: {
          status: "disabled",
          reason: "No recorded iOS route. Do not invent Grok Settings navigation.",
          repairTargetId: "ios-files",
          decidedBy: "reviewer",
          decidedAt: 1,
        },
      }),
    ).toMatch(/^Disabled · No recorded iOS route/u);
  });

  it("names a recorded-route compile-block instead of Ready", () => {
    expect(
      stepReadinessLabel(
        {
          id: "offline",
          kind: "instruction",
          intent: "Toggle browser offline",
          binding: { status: "resolved", kind: "connections", connectionIds: ["offline"] },
        },
        { platformBlocker: "offline is a browser step" },
      ),
    ).toMatch(/^Blocked · offline is a browser step/u);
  });

  it("names a recorded iOS upload compile-block instead of Ready", () => {
    expect(
      stepReadinessLabel(
        {
          id: "upload",
          kind: "instruction",
          intent: "Upload a file",
          binding: { status: "resolved", kind: "connections", connectionIds: ["upload"] },
        },
        {
          platformBlocker:
            "upload on iOS requires a reviewed Files-app handoff; disable this step or record that path",
        },
      ),
    ).toMatch(/^Blocked · upload on iOS requires a reviewed Files-app handoff/u);
  });
});
