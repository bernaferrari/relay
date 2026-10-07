/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { AuthoringTarget } from "@relay/protocol";
import type {
  ProductRecordingState,
  RecordingProductService,
} from "../data/recording-product-service";
import { useRecordingConditionRecovery } from "./use-recording-condition-recovery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});
const target = { kind: "device", platform: "ios", targetId: "ipad-fixture" } as const;
const error = Object.assign(new Error("The Wait response was lost"), {
  code: "mutation-outcome-unknown",
  recordingMutation: {
    mutationId: "condition-request",
    workflowId: "workflow-1",
    sessionId: "session-1",
    transitionVersion: 7,
    target,
  },
});

async function harness(
  outcome: "applied" | "failed" | "unknown",
  problem?: ProductRecordingState["recovery"],
) {
  const reset = vi.fn();
  const fetch = vi.fn(async () => ({ outcome }));
  const inspect = vi.fn(
    async () =>
      ({
        snapshot: { workflow: { workflowId: "workflow-1" } },
        ...(problem ? { recovery: problem } : {}),
      }) as ProductRecordingState,
  );
  const receiptService = {
    fetchRecordingInputReceipt: fetch,
    inspect,
  } satisfies Pick<RecordingProductService, "fetchRecordingInputReceipt" | "inspect">;
  // This hook only uses the checked receipt/read seam; other service methods
  // are intentionally absent so the test cannot dispatch input.
  const service = receiptService as unknown as RecordingProductService;
  const queryClient = new QueryClient();
  let blocked = false;
  function Probe({ issue, selected }: { issue: unknown; selected: AuthoringTarget }) {
    blocked = useRecordingConditionRecovery({
      action: { isError: true, error: issue, variables: { action: "condition" }, reset },
      recording: { selectedTarget: selected } as ProductRecordingState,
      workflowId: "workflow-1",
      service,
      queryClient,
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  async function render(issue: unknown = error, selected: AuthoringTarget = target) {
    await act(async () => root!.render(<Probe issue={issue} selected={selected} />));
  }
  return { render, reset, fetch, inspect, blocked: () => blocked };
}

it("keeps a genuinely unknown condition blocked until its exact applied receipt and healthy workflow read", async () => {
  const h = await harness("applied");
  await h.render();
  expect(h.fetch).toHaveBeenCalledExactlyOnceWith(error.recordingMutation);
  expect(h.inspect).toHaveBeenCalledExactlyOnceWith("workflow-1");
  expect(h.reset).toHaveBeenCalledOnce();
});

it.each(["failed", "unknown"] as const)(
  "does not turn a %s read into condition success",
  async (outcome) => {
    vi.useFakeTimers();
    const h = await harness(outcome);
    await h.render();
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(h.blocked()).toBe(true);
    expect(h.inspect).not.toHaveBeenCalled();
    expect(h.reset).not.toHaveBeenCalled();
  },
);

it("keeps the condition fenced if its confirmation cannot refresh the workflow", async () => {
  const h = await harness("applied", {
    code: "operation-unavailable",
    title: "Relay unavailable",
    detail: "Could not refresh",
    recovery: "Check status",
    retryable: true,
  });
  await h.render();
  expect(h.reset).not.toHaveBeenCalled();
});

it("does not read or fence a known failed condition, or accept another target's receipt", async () => {
  const h = await harness("applied");
  await h.render(
    Object.assign(new Error("Copy was not found"), {
      code: "operation-unavailable",
      sourceCode: "AUTHORING_INTERACTION_FAILED",
    }),
  );
  expect(h.blocked()).toBe(false);
  expect(h.fetch).not.toHaveBeenCalled();
  await h.render(error, { ...target, targetId: "another-ipad" });
  expect(h.blocked()).toBe(true);
  expect(h.fetch).not.toHaveBeenCalled();
  expect(h.reset).not.toHaveBeenCalled();
});
