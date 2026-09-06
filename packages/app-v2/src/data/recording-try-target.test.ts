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
  it("taps the selected control through preview, then closes without recording", async () => {
    const inputs: unknown[] = [];
    const preview = session(async (value) => {
      inputs.push(value);
    });
    const previewTarget = vi.fn(async () => preview);

    await expect(
      tryReviewTarget({
        previewTarget,
        selectedTarget: device,
        control,
      }),
    ).resolves.toEqual({
      kind: "tried",
      detail: "Relay tapped Preferred language on the Device.",
    });
    expect(previewTarget).toHaveBeenCalledWith(device);
    expect(inputs).toEqual([
      { kind: "touch", action: "down", x: 168, y: 304 },
      { kind: "touch", action: "up", x: 168, y: 304 },
    ]);
    expect(preview.close).toHaveBeenCalledOnce();
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
      }),
    ).resolves.toEqual({
      kind: "failed",
      detail: "The live target session is closed",
    });
    expect(preview.close).toHaveBeenCalledOnce();
  });
});
