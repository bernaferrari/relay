import { describe, expect, it } from "vitest";
import { testRoutePlatformStatuses } from "@relay/product/test-route-platforms";
import { stepReadinessLabel } from "./test-editor-step";

describe("test editor platform routes", () => {
  it("shows Android and iOS as not recorded for a grok.com test", () => {
    const statuses = testRoutePlatformStatuses({
      originApplication: "https://grok.com/",
    });
    expect(statuses.find((item) => item.platform === "android")?.status).toBe("unrecorded");
    expect(statuses.find((item) => item.platform === "ios")?.reason).toMatch(
      /Record this test on iOS before running it there/u,
    );
  });

  it("shows Android as Linked, never Recorded, when a companion is set", () => {
    const statuses = testRoutePlatformStatuses({
      originApplication: "https://grok.com/",
      nativeRouteCompanions: [
        {
          platform: "android",
          appMapId: "grok-android",
          testId: "test-grok-android-home-chrome",
        },
      ],
    });
    expect(statuses.find((item) => item.platform === "android")?.status).toBe("linked");
    expect(statuses.find((item) => item.platform === "ios")?.status).toBe("unrecorded");
  });

  it("shows compile-blocked iOS as Blocked, never Recorded", () => {
    const statuses = testRoutePlatformStatuses(
      {
        family: {
          logicalIntentRevision: 1,
          bindingRevision: 1,
          routeVariants: [
            {
              id: "ios",
              revision: 1,
              predicate: { platforms: ["ios"] },
              bindings: {},
              reviewedAt: 1,
              reviewedBy: "reviewer",
            },
          ],
        },
      },
      {
        platformBlockers: {
          ios: "airplane on iOS is a Settings handoff, not settings airplane on the Grok runner",
        },
      },
    );
    expect(statuses.find((item) => item.platform === "ios")?.status).toBe("blocked");
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

  it("names a recorded iOS airplane compile-block instead of Ready", () => {
    expect(
      stepReadinessLabel(
        {
          id: "airplane",
          kind: "instruction",
          intent: "Toggle airplane mode",
          binding: { status: "resolved", kind: "connections", connectionIds: ["airplane"] },
        },
        {
          platformBlocker:
            "airplane on iOS is a Settings handoff, not settings airplane on the Grok runner",
        },
      ),
    ).toMatch(/^Blocked · airplane on iOS is a Settings handoff/u);
  });

  it("names a missing origin variant instead of Ready", () => {
    expect(
      stepReadinessLabel(
        {
          id: "share",
          kind: "instruction",
          intent: "Share Conversation and Delete menu",
          binding: { status: "resolved", kind: "connections", connectionIds: ["share"] },
        },
        { originEvidenceMissing: "Signed-in SuperGrok home" },
      ),
    ).toMatch(/^Needs origin evidence · Signed-in SuperGrok home/u);
  });

  it("uses actual generation bindings and preserves explicit draft labels", () => {
    const step = {
      id: "generate",
      kind: "instruction" as const,
      intent: "Make image",
      binding: {
        status: "resolved" as const,
        kind: "connections" as const,
        connectionIds: ["generate"],
      },
    };
    for (const productName of ["Imagine Speed", "Chat Heavy", "Video generation 1080p"]) {
      expect(stepReadinessLabel(step, { productName })).toBe("Ready");
      expect(stepReadinessLabel(step, { productName: `DRAFT — ${productName}` })).toBe(
        "Unrecorded",
      );
      expect(stepReadinessLabel(step, { productName: `UNRECORDED — ${productName}` })).toBe(
        "Unrecorded",
      );
      expect(
        stepReadinessLabel(
          { ...step, binding: { status: "unresolved", reason: "Record the Generate action" } },
          { productName },
        ),
      ).toBe("Needs setup");
    }
  });

  it("names Start Thread absent as Unrecorded, not Ready", () => {
    expect(
      stepReadinessLabel({
        id: "thread",
        kind: "instruction",
        intent: "Start Thread signed-in",
        binding: {
          status: "unresolved",
          reason: "Start Thread is absent from the recorded tree — unrecorded.",
        },
      }),
    ).toMatch(/^Unrecorded · Start Thread is absent/u);
    expect(
      stepReadinessLabel(
        {
          id: "more",
          kind: "instruction",
          intent: "Header More on existing chat",
          binding: { status: "resolved", kind: "connections", connectionIds: ["more"] },
        },
        { productName: "Header More on existing chat (Start Thread still absent)" },
      ),
    ).toBe("Unrecorded");
    expect(
      stepReadinessLabel({
        id: "heavy",
        kind: "instruction",
        intent: "Chat Heavy signed-in",
        binding: {
          status: "unresolved",
          reason:
            "No Non-QA SuperGrok Heavy account — do not burn the QA lab fixture on Imagine/video/Heavy — unrecorded.",
        },
      }),
    ).toMatch(/^Unrecorded · No Non-QA SuperGrok Heavy account/u);
  });
});
