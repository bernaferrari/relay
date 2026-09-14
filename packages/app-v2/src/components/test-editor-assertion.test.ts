import { describe, expect, it } from "vitest";
import {
  IDENTITY_IGNORE_PRESETS,
  VALIDATION_KIND_GROUPS,
  checkpointBindingCopy,
  isValidationDraftReady,
  parseRegion,
  stepBindingCopy,
  validationBindingFromDraft,
} from "./test-editor-assertion";

describe("test editor assertions", () => {
  it("groups Check, Wait, Judges, and Ignore region", () => {
    expect(VALIDATION_KIND_GROUPS.map((group) => group.label)).toEqual([
      "Check",
      "Wait",
      "Judges",
      "Ignore region",
    ]);
    expect(
      VALIDATION_KIND_GROUPS.flatMap((group) => group.kinds.map((kind) => kind.value)),
    ).toEqual(["screen", "content", "wait-response", "semantic", "visual", "identity-ignore"]);
  });

  it("compiles a semantic judge and a reply wait without YAML", () => {
    expect(
      validationBindingFromDraft({
        kind: "semantic",
        input: "reply",
        criteria: "Reply must mention a location",
        requireAgreement: false,
      }),
    ).toEqual({
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "semantic",
        input: "reply",
        criteria: ["Reply must mention a location"],
      },
    });
    expect(
      validationBindingFromDraft({
        kind: "wait-response",
        label: "Ask anything",
        maxMs: "1000",
      }),
    ).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: { kind: "wait-response", target: { label: "Ask anything" }, maxMs: 1000 },
    });
    expect(
      validationBindingFromDraft({
        kind: "visual",
        criteria: "Composer is visible",
        region: "80,200,900,1400",
        requireAgreement: true,
      }),
    ).toEqual({
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "visual",
        criteria: ["Composer is visible"],
        region: { x: 80, y: 200, width: 900, height: 1400 },
        requireAgreement: true,
      },
    });
    expect(
      validationBindingFromDraft({
        kind: "identity-ignore",
        name: "reply body",
        region: "80,200,900,1400",
      }),
    ).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "identity-ignore",
        region: { x: 80, y: 200, width: 900, height: 1400 },
        name: "reply body",
      },
    });
  });

  it("keeps an incomplete visual crop from saving", () => {
    expect(
      isValidationDraftReady({
        kind: "visual",
        criteria: "Composer is visible",
        region: "80,200",
        requireAgreement: true,
      }),
    ).toBe(false);
  });

  it("fills a named ignore-region preset that compiles without YAML", () => {
    const preset = IDENTITY_IGNORE_PRESETS.find((item) => item.id === "user-bubble");
    expect(preset).toBeDefined();
    expect(parseRegion(preset!.region)).toEqual({ x: 0.7, y: 0.08, width: 0.28, height: 0.1 });
    const cookie = IDENTITY_IGNORE_PRESETS.find((item) => item.id === "cookie-banner");
    expect(cookie).toBeDefined();
    expect(parseRegion(cookie!.region)).toEqual({ x: 0.57, y: 0.8, width: 0.43, height: 0.2 });
    const composer = IDENTITY_IGNORE_PRESETS.find((item) => item.id === "composer-placeholder");
    expect(composer).toBeDefined();
    expect(parseRegion(composer!.region)).toEqual({ x: 0.21, y: 0.29, width: 0.57, height: 0.06 });
    expect(
      isValidationDraftReady({
        kind: "identity-ignore",
        name: preset!.name,
        region: preset!.region,
      }),
    ).toBe(true);
    expect(
      validationBindingFromDraft({
        kind: "identity-ignore",
        name: cookie!.name,
        region: cookie!.region,
      }),
    ).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "identity-ignore",
        region: { x: 0.57, y: 0.8, width: 0.43, height: 0.2 },
        name: "cookie banner",
      },
    });
  });

  it("names a saved wait-for checkpoint instead of dumping it as Advanced JSON", () => {
    expect(
      checkpointBindingCopy({
        id: "step-imagine",
        kind: "validation",
        intent: "Wait until Imagine is visible on logged-out home",
        capture: true,
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: {
            kind: "expect",
            target: { label: "Imagine" },
            condition: "visible",
          },
        },
      }),
    ).toBe("Waits until Imagine is visible.");
  });

  it("names a recorded wait-until-visible assertion the same way", () => {
    expect(
      checkpointBindingCopy({
        id: "step-imagine-assert",
        kind: "validation",
        intent: "Wait until Imagine is visible on logged-out home",
        capture: true,
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: {
            kind: "target",
            target: { label: "Imagine" },
            condition: "visible",
          },
        },
      }),
    ).toBe("Waits until Imagine is visible.");
  });

  it("describes a saved action as a path, not JSON", () => {
    expect(
      stepBindingCopy({
        id: "step-open",
        kind: "instruction",
        intent: "Open Imagine",
        capture: false,
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["connection-imagine"],
        },
      }),
    ).toBe("Uses one saved path.");
    expect(
      checkpointBindingCopy({
        id: "step-screen",
        kind: "validation",
        intent: "On signed-in home",
        capture: true,
        binding: {
          status: "resolved",
          kind: "assertion",
          assertion: { kind: "screen", screenId: "screen-cb4f24083a69e660" },
        },
      }),
    ).toBe("Checks that the expected screen is showing.");
  });
});
