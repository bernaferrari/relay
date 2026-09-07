import { describe, expect, it, vi } from "vitest";
import type { AuthoringTarget } from "@relay/protocol";
import type { LiveTargetSession } from "./live-target-session";
import { tryReviewTarget } from "./recording-try-target";

const control = {
  id: "preferred-language",
  name: "Preferred language",
  role: "button",
  rect: { x: 48, y: 280, width: 240, height: 48 },
  target: { label: "Preferred language" },
  why: "Matched the visible name.",
};

const device: AuthoringTarget = {
  kind: "device",
  platform: "android",
  targetId: "emulator-5554",
};

function session(input?: LiveTargetSession["input"]): LiveTargetSession {
  return {
    snapshot: () => ({ status: "streaming", target: device }),
    subscribe: () => () => undefined,
    mount: () => () => undefined,
    input: input ?? (async () => undefined),
    close: vi.fn(),
  };
}

describe("tryReviewTarget", () => {
  it("resolves the saved binding on a fresh observation instead of the historic rectangle", async () => {
    const inputs: unknown[] = [];
    const preview = session(async (value) => {
      inputs.push(value);
    });
    const previewTarget = vi.fn(async () => preview);
    const moved = { ...control, rect: { x: 80, y: 400, width: 240, height: 48 } };

    await expect(
      tryReviewTarget({
        previewTarget,
        selectedTarget: device,
        control,
        confirmStartingState: async () => ({ ok: true }),
        observe: async (live) => {
          expect(live).toBe(preview);
          return [moved];
        },
      }),
    ).resolves.toEqual({
      kind: "tried",
      binding: { label: "Preferred language" },
      detail: "Relay tried Preferred language as the saved binding.",
    });
    expect(previewTarget).toHaveBeenCalledWith(device);
    expect(inputs).toEqual([{ kind: "tap", target: { label: "Preferred language" } }]);
    expect(inputs.some((value) => value && typeof value === "object" && "x" in value)).toBe(false);
    expect(preview.close).toHaveBeenCalledOnce();
  });

  it("refuses a historic-rectangle trial when there is no fresh observation", async () => {
    const inputs: unknown[] = [];
    await expect(
      tryReviewTarget({
        previewTarget: async () =>
          session(async (value) => {
            inputs.push(value);
          }),
        selectedTarget: device,
        control,
        confirmStartingState: async () => ({ ok: true }),
      }),
    ).resolves.toMatchObject({
      kind: "failed",
      detail: expect.stringMatching(/fresh observation/i),
    });
    expect(inputs).toEqual([]);
  });

  it("refuses to try when the starting state is not confirmed", async () => {
    const inputs: unknown[] = [];
    await expect(
      tryReviewTarget({
        previewTarget: async () =>
          session(async (value) => {
            inputs.push(value);
          }),
        selectedTarget: device,
        control,
        observe: async () => [control],
      }),
    ).resolves.toMatchObject({
      kind: "failed",
      detail: expect.stringMatching(/starting state/i),
    });
    expect(inputs).toEqual([]);
  });

  it("refuses an observation-local ref labeled as a stable identifier", async () => {
    await expect(
      tryReviewTarget({
        previewTarget: async () => session(),
        selectedTarget: device,
        control: {
          ...control,
          target: { identifier: "node-14" },
        },
      }),
    ).resolves.toMatchObject({
      kind: "failed",
      detail: expect.stringMatching(/observation-local/i),
    });
  });

  it("does not invent a successful try when the Device is missing", async () => {
    await expect(tryReviewTarget({ control })).resolves.toEqual({
      kind: "failed",
      detail: "Relay cannot open this Device to try the target.",
    });
  });

  it("returns the Device error instead of keeping an untried target", async () => {
    const preview = session(async () => {
      throw new Error("The live target session is closed");
    });
    await expect(
      tryReviewTarget({
        previewTarget: async () => preview,
        selectedTarget: device,
        control,
        confirmStartingState: async () => ({ ok: true }),
        observe: async () => [control],
      }),
    ).resolves.toEqual({
      kind: "unknown",
      binding: { label: "Preferred language" },
      detail: "The live target session is closed",
    });
    expect(preview.close).toHaveBeenCalledOnce();
  });

  it("closes the preview when the binding is not on the current screen", async () => {
    const inputs: unknown[] = [];
    const preview = session(async (value) => {
      inputs.push(value);
    });
    await expect(
      tryReviewTarget({
        previewTarget: async () => preview,
        selectedTarget: device,
        control,
        confirmStartingState: async () => ({ ok: true }),
        observe: async () => [],
      }),
    ).resolves.toMatchObject({ kind: "failed", detail: expect.stringMatching(/current screen/i) });
    expect(preview.close).toHaveBeenCalledOnce();
    expect(inputs).toEqual([]);
  });

  it("closes the preview when observation fails before dispatch", async () => {
    const inputs: unknown[] = [];
    const preview = session(async (value) => {
      inputs.push(value);
    });
    await expect(
      tryReviewTarget({
        previewTarget: async () => preview,
        selectedTarget: device,
        control,
        confirmStartingState: async () => ({ ok: true }),
        observe: async () => {
          throw new Error("tree unavailable");
        },
      }),
    ).resolves.toEqual({ kind: "failed", detail: "tree unavailable" });
    expect(preview.close).toHaveBeenCalledOnce();
    expect(inputs).toEqual([]);
  });

  it("keeps post-dispatch transport loss unknown instead of ordinary failure", async () => {
    const preview = session(async () => {
      throw new Error("socket closed");
    });
    await expect(
      tryReviewTarget({
        previewTarget: async () => preview,
        selectedTarget: device,
        control,
        confirmStartingState: async () => ({ ok: true }),
        observe: async () => [control],
      }),
    ).resolves.toMatchObject({
      kind: "unknown",
      binding: { label: "Preferred language" },
    });
  });
});
