import { describe, expect, it, vi } from "vitest";
import { checkNativeLiveControl } from "./native-live-control";

describe("live control admission", () => {
  it("accepts proven iOS window bounds even without accessibility controls", async () => {
    const invoke = vi.fn(async (operation) =>
      operation === "target.health.get"
        ? { health: { control: { state: "available" }, input: { state: "ready" } } }
        : {
            bounds: { width: 834, height: 1112 },
            boundsSource: "current-window",
            inspectable: false,
          },
    );
    expect(await checkNativeLiveControl({ invoke } as never, "ipad", "ios")).toEqual({
      ready: true,
    });
    expect(invoke.mock.calls.map(([operation]) => operation)).toEqual([
      "target.health.get",
      "target.snapshot.capture",
    ]);
  });
  it("keeps unproven pixels read-only and offers recovery without sending it", async () => {
    const invoke = vi.fn(async (operation) =>
      operation === "target.health.get"
        ? { health: { control: { state: "available" }, input: { state: "ready" } } }
        : { bounds: { width: 1668, height: 2224 }, boundsSource: "png" },
    );
    expect(await checkNativeLiveControl({ invoke } as never, "ipad", "ios")).toMatchObject({
      ready: false,
      recoverable: true,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it.each(["uncertain", "blocked"])("never retries or repairs an %s input", async (state) => {
    const invoke = vi.fn(async () => ({
      health: { control: { state: "available" }, input: { state } },
    }));
    expect(await checkNativeLiveControl({ invoke } as never, "ipad", "ios")).toMatchObject({
      ready: false,
      recoverable: false,
    });
    expect(invoke).toHaveBeenCalledOnce();
  });
  it("does not take over a device held by another session", async () => {
    const invoke = vi.fn(async () => ({
      health: { control: { state: "held-by-other" }, input: { state: "ready" } },
    }));
    expect(await checkNativeLiveControl({ invoke } as never, "ipad", "ios")).toMatchObject({
      ready: false,
      recoverable: false,
    });
    expect(invoke).toHaveBeenCalledOnce();
  });
});
