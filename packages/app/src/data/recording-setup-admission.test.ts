import { describe, expect, it, vi } from "vitest";
import { createRecordingSetupAdmission } from "./recording-setup-admission";

describe("recording startup admission", () => {
  it("owns setup synchronously through the original receipt and ignores a second start", async () => {
    const admission = createRecordingSetupAdmission();
    const mayEdit = admission.mayEdit;
    let finish!: (receipt: object) => void;
    const receipt = { workflowId: "original" };
    const pending = admission.run(
      () =>
        new Promise<object>((resolve) => {
          finish = resolve;
        }),
    );
    expect(mayEdit()).toBe(false);
    const duplicate = vi.fn(async () => ({ workflowId: "second" }));
    expect(await admission.run(duplicate)).toBeUndefined();
    expect(duplicate).not.toHaveBeenCalled();
    finish(receipt);
    expect(await pending).toBe(receipt);
    expect(mayEdit()).toBe(true);
  });

  it("releases setup after a known rejected start without automatically repeating it", async () => {
    const admission = createRecordingSetupAdmission();
    const failure = new Error("Begin rejected before dispatch");
    const start = vi.fn(async () => {
      throw failure;
    });
    await expect(admission.run(start)).rejects.toBe(failure);
    expect(start).toHaveBeenCalledOnce();
    expect(admission.mayEdit()).toBe(true);
  });
});
