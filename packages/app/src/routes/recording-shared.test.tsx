/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RecordingProblem } from "./recording-shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});
async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

it("preserves the next step alongside the explanation", async () => {
  const host = await render(
    <RecordingProblem
      recovery={{
        title: "Starting screen unavailable",
        detail: "This Test needs a new starting screen.",
        recovery: "Open the Test and record its starting screen again.",
        retryable: false,
      }}
    />,
  );
  expect(host.textContent).toContain("This Test needs a new starting screen.");
  expect(host.textContent).toContain("Open the Test and record its starting screen again.");
});

it("does not offer to repeat an error explicitly marked non-retryable", async () => {
  const retry = vi.fn();
  const host = await render(
    <RecordingProblem
      error={{
        title: "Access unavailable",
        detail: "This account cannot open this Test.",
        recovery: "Ask a workspace administrator for access.",
        retryable: false,
      }}
      onRetry={retry}
    />,
  );
  expect(host.querySelector("button")).toBeNull();
  expect(retry).not.toHaveBeenCalled();
});

it("offers connection retry and disables it while checking", async () => {
  const host = await render(
    <RecordingProblem error={new TypeError("Failed to fetch")} onRetry={vi.fn()} retrying />,
  );
  expect(host.querySelector("button")?.disabled).toBe(true);
  expect(host.textContent).toContain("Trying again");
  expect(host.textContent).toContain("Start Relay");
});

it("does not describe a Run preparation failure as restoring work", async () => {
  const host = await render(
    <RecordingProblem
      operation="run"
      recovery={{
        code: "operation-unavailable",
        title: "Relay could not reserve the durable Run workflow",
        detail: "Workflow request identity is missing",
        recovery: "Resolve the reported Relay problem, then start this workflow again explicitly.",
        retryable: true,
      }}
    />,
  );
  expect(host.textContent).not.toContain("restore this work");
  expect(host.textContent).toContain("Relay could not complete this request");
  expect(host.textContent).not.toContain("Workflow request identity");
});

it("identifies interrupted replay without offering another execution", async () => {
  const retry = vi.fn();
  const host = await render(
    <RecordingProblem
      operation="replay"
      recovery={{
        code: "mutation-outcome-unknown",
        title: "Outcome unknown",
        detail: "Pending receipt",
        recovery: "Inspect",
        retryable: false,
      }}
      onRetry={retry}
    />,
  );
  expect(host.textContent).toContain("Replay was interrupted. Your saved steps are safe.");
  expect(host.textContent).not.toContain("Step status");
  expect(host.textContent).not.toContain("Try again");
  expect(host.querySelector("button")?.textContent).toContain("Check status");
  expect(retry).not.toHaveBeenCalled();
});
