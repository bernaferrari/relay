/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingInputNotSentError } from "../data/recording-input-outcome";
import type { LiveTargetSession } from "../data/live-target-session";
import type { RecordingProductService } from "../data/recording-product-service";
import type { ProductTargetOption } from "../data/target-presentation";
import { useNewTestPreviewInput } from "./use-new-test-preview-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});
const target: ProductTargetOption = {
  kind: "device",
  targetId: "phone-1",
  platform: "android",
  name: "Phone",
  detail: "",
};
const tap = { kind: "tap", target: { label: "Send" } } as const;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function harness(
  options: {
    input?: LiveTargetSession["input"];
    service?: Pick<
      RecordingProductService,
      "inspectTargetHealth" | "reconcileInput" | "fetchReconcileReceipt"
    >;
    stored?: string;
  } = {},
) {
  const input = options.input ?? vi.fn(async () => {});
  const values = new Map(
    options.stored ? [["live-input-ledger:android:phone-1", options.stored]] : [],
  );
  const storage = {
    get: vi.fn((key: string) => values.get(key) ?? null),
    set: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  const service = options.service ?? {};
  const session = { current: { input } as LiveTargetSession };
  let result!: ReturnType<typeof useNewTestPreviewInput>;
  function Probe({ selected, attempt }: { selected: ProductTargetOption; attempt: number }) {
    result = useNewTestPreviewInput({ target: selected, session, storage, service, attempt });
    return <output>{result.failure ? "unknown" : result.busy ? "busy" : "ready"}</output>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  async function render(selected = target, attempt = 0) {
    await act(async () => root!.render(<Probe selected={selected} attempt={attempt} />));
  }
  await render();
  return {
    get result() {
      return result;
    },
    input,
    storage,
    values,
    render,
  };
}

describe("new-Test preview input fence", () => {
  it("retains lost confirmation across preview reconnect and remount, and reconciles through the server", async () => {
    const input = vi.fn(async () => {
      throw Object.assign(new Error("response lost"), { mutationId: "ios-input-lost" });
    });
    const reconcile = vi.fn(async () => ({
      mutationId: "ios-input-lost",
      outcome: "applied" as const,
      health: { state: "ready" as const },
    }));
    const first = await harness({ input, service: { reconcileInput: reconcile } });
    await act(async () => {
      expect(await first.result.send(tap)).toBe(false);
    });
    expect(first.result.failure?.mutationId).toBe("ios-input-lost");
    const saved = first.values.get("live-input-ledger:android:phone-1")!;
    await first.render(target, 1);
    await act(async () => {
      expect(await first.result.send(tap)).toBe(false);
    });
    expect(input).toHaveBeenCalledTimes(1);
    await act(async () => root!.unmount());
    root = undefined;
    const next = await harness({ input, stored: saved, service: { reconcileInput: reconcile } });
    expect(next.result.failure?.mutationId).toBe("ios-input-lost");
    await act(async () => next.result.observe("applied"));
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        serial: "phone-1",
        mutationId: "ios-input-lost",
        outcome: "applied",
        reconcilePending: true,
      }),
    );
    expect(next.result.failure).toBeUndefined();
    expect(
      JSON.parse(next.values.get("live-input-ledger:android:phone-1")!).mutations[0].resolvedBy
        .authority,
    ).toBe("server");
  });
  it("permits retry only when typed pre-dispatch refusal proves no input was sent", async () => {
    const input = vi
      .fn()
      .mockRejectedValueOnce(new RecordingInputNotSentError("screen size unavailable"))
      .mockResolvedValue(undefined);
    const h = await harness({ input });
    await act(async () => {
      expect(await h.result.send(tap)).toBe(false);
    });
    expect(h.result.failure).toBeUndefined();
    expect(h.result.issue).toContain("Input was not sent");
    await act(async () => {
      expect(await h.result.send(tap)).toBe(true);
    });
    expect(input).toHaveBeenCalledTimes(2);
    expect(h.storage.set).not.toHaveBeenCalled();
  });
  it("blocks duplicate input before the first response arrives", async () => {
    const pending = deferred<void>();
    const input = vi.fn(() => pending.promise);
    const h = await harness({ input });
    let first!: Promise<boolean>;
    await act(async () => {
      first = h.result.send(tap);
      expect(await h.result.send(tap)).toBe(false);
    });
    expect(input).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve();
      expect(await first).toBe(true);
    });
  });
  it("does not apply a late failure from the previous device to the newly selected device", async () => {
    const pending = deferred<void>();
    const input = vi.fn(() => pending.promise);
    const h = await harness({ input });
    let first!: Promise<boolean>;
    await act(async () => {
      first = h.result.send(tap);
    });
    await h.render({ ...target, targetId: "phone-2" });
    await act(async () => {
      pending.reject(new Error("lost old device response"));
      await first;
    });
    expect(h.result.failure).toBeUndefined();
    expect(h.result.busy).toBe(false);
    expect(h.values.get("live-input-ledger:android:phone-1")).toContain("unknown");
    expect(h.values.has("live-input-ledger:android:phone-2")).toBe(false);
    await h.render(target);
    expect(h.result.failure?.kind).toBe("unknown");
  });
  it("hydrates a durable pending mutation and keeps failed reconciliation paused", async () => {
    const reconcile = vi.fn(async () => {
      throw new Error("offline");
    });
    const h = await harness({
      service: {
        inspectTargetHealth: async () => ({
          input: { state: "uncertain", pendingMutationId: "browser-input-pending" },
        }),
        reconcileInput: reconcile,
      },
    });
    expect(h.result.failure?.mutationId).toBe("browser-input-pending");
    await act(async () => h.result.observe("applied"));
    expect(h.result.issue).toContain("Could not confirm");
    await act(async () => {
      expect(await h.result.send(tap)).toBe(false);
    });
    expect(h.input).not.toHaveBeenCalled();
  });
});
