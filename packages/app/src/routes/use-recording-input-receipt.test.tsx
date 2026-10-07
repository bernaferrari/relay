/** @jsxImportSource react */
import { act, startTransition, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthoringTarget } from "@relay/protocol";
import type { RecordingInputOutcome } from "../data/recording-input-outcome";
import type { RecordingProductService } from "../data/recording-product-service";
import { useRecordingInputReceipt } from "./use-recording-input-receipt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});
const target = {
  kind: "browser",
  platform: "browser",
  targetId: "browser-1",
  liveSessionId: "live-1",
} as const;
const failure: RecordingInputOutcome = {
  kind: "unknown",
  mutationId: "recording-mutation-1",
  message: "Response lost",
  recordingMutation: {
    mutationId: "recording-1",
    workflowId: "workflow-1",
    sessionId: "session-1",
    transitionVersion: 5,
    target,
  },
};
async function harness(
  fetch: NonNullable<RecordingProductService["fetchRecordingInputReceipt"]>,
  suspendNewWorkflow = false,
  currentFailure = failure,
) {
  const confirmed = vi.fn(async () => {});
  const service = { fetchRecordingInputReceipt: fetch } as RecordingProductService;
  const suspended = new Promise<void>(() => {});
  function Probe({ selected, workflowId }: { selected: AuthoringTarget; workflowId: string }) {
    useRecordingInputReceipt({
      failure: currentFailure,
      target: selected,
      workflowId,
      service,
      onConfirmed: confirmed,
    });
    if (suspendNewWorkflow && workflowId === "workflow-2") throw suspended;
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  async function render(
    selected: AuthoringTarget = currentFailure.kind === "unknown"
      ? (currentFailure.recordingMutation?.target ?? target)
      : target,
    workflowId = "workflow-1",
    transition = false,
  ) {
    await act(async () => {
      const update = () =>
        root!.render(
          <Suspense fallback={null}>
            <Probe selected={selected} workflowId={workflowId} />
          </Suspense>,
        );
      if (transition) startTransition(update);
      else update();
    });
  }
  await render();
  return { render, confirmed };
}

describe("bounded automatic recording receipt recovery", () => {
  it.each(["ios", "android"] as const)(
    "recovers a late %s receipt through reads alone",
    async (platform) => {
      vi.useFakeTimers();
      const nativeFailure: RecordingInputOutcome = {
        ...failure,
        recordingMutation: {
          ...failure.recordingMutation!,
          target: { kind: "device", platform, targetId: "native-1" },
        },
      };
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ outcome: "unknown" })
        .mockResolvedValue({ outcome: "applied" });
      const h = await harness(fetch, false, nativeFailure);
      expect(h.confirmed).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(750));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenLastCalledWith(nativeFailure.recordingMutation);
      expect(h.confirmed).toHaveBeenCalledWith(nativeFailure, expect.any(Function));
    },
  );
  it("ignores old success when a new workflow render suspends before effect cleanup", async () => {
    let resolve!: (value: { outcome: "applied" }) => void;
    const fetch = vi.fn(
      () =>
        new Promise<{ outcome: "applied" }>((yes) => {
          resolve = yes;
        }),
    );
    const h = await harness(fetch, true);
    await h.render(target, "workflow-2", true);
    await act(async () => resolve({ outcome: "applied" }));
    expect(h.confirmed).not.toHaveBeenCalled();
  });
  it("waits through unknown outcomes, then accepts only applied", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "unknown" })
      .mockResolvedValue({ outcome: "applied" });
    const h = await harness(fetch);
    expect(h.confirmed).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(h.confirmed).toHaveBeenCalledWith(failure, expect.any(Function));
  });
  it("keeps a failed outcome fenced without inventing success", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({ outcome: "failed" });
    const h = await harness(fetch);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.confirmed).not.toHaveBeenCalled();
  });
  it("bounds unavailable receipt reads and leaves manual recovery intact", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new Error("Receipt unavailable"));
    const h = await harness(fetch);
    await act(async () => vi.advanceTimersByTimeAsync(61_000));
    const attempts = fetch.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetch).toHaveBeenCalledTimes(attempts);
    expect(h.confirmed).not.toHaveBeenCalled();
  });
  it.each(["workflow", "target", "browser session", "account"])(
    "ignores an old response after changing %s",
    async (scope) => {
      let resolve!: (value: { outcome: "applied" }) => void;
      const fetch = vi.fn(
        () =>
          new Promise<{ outcome: "applied" }>((yes) => {
            resolve = yes;
          }),
      );
      const h = await harness(fetch);
      await h.render(
        scope === "target"
          ? { ...target, targetId: "browser-2" }
          : scope === "browser session"
            ? { ...target, liveSessionId: "live-2" }
            : scope === "account"
              ? { ...target, authenticationFixtureId: "admin" }
              : target,
        scope === "workflow" ? "workflow-2" : "workflow-1",
      );
      await act(async () => resolve({ outcome: "applied" }));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(h.confirmed).not.toHaveBeenCalled();
    },
  );
});
