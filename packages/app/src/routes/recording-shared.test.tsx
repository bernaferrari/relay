/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RecordingProblem } from "./recording-shared";
import { ApiError } from "@relay/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

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

async function renderInTestRouter(node: React.ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  const testRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tests/$testId",
    component: () => node,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ["/tests/test-speed"] }),
  });
  await router.load();
  const host = await render(<RouterProvider router={router} />);
  return { host, router };
}

it("preserves the next step alongside the explanation", async () => {
  const host = await render(
    <RecordingProblem
      recovery={{
        title: "Starting screen unavailable",
        detail: "This test needs a new starting screen.",
        recovery: "Open the test and record its starting screen again.",
        retryable: false,
      }}
    />,
  );
  expect(host.textContent).toContain("This test needs a new starting screen.");
  expect(host.textContent).toContain("Open the test and record its starting screen again.");
});

it("does not offer to repeat an error explicitly marked non-retryable", async () => {
  const retry = vi.fn();
  const host = await render(
    <RecordingProblem
      error={{
        title: "Access unavailable",
        detail: "This account cannot open this test.",
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

it("preserves explicit inspection transport provenance without exposing private recovery text", async () => {
  const retry = vi.fn();
  const host = await render(
    <RecordingProblem
      recovery={{
        code: "operation-unavailable",
        sourceCode: "local-service-transport",
        title: "Relay could not inspect the durable recording workflow",
        detail: "Failed to fetch workflow private-recording",
        recovery: "Inspect workflow private-recording again",
        retryable: true,
      }}
      onRetry={retry}
    />,
  );
  expect(host.textContent).toContain("Relay is not connected");
  expect(host.textContent).not.toMatch(/private-recording|Relay needs your attention/u);
  expect(retry).not.toHaveBeenCalled();
});

it("does not describe a run preparation failure as restoring work", async () => {
  const host = await render(
    <RecordingProblem
      operation="run"
      recovery={{
        code: "operation-unavailable",
        title: "Relay could not reserve the durable run workflow",
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
  expect(host.textContent).toContain("Replay status needs checking. Your saved steps are safe.");
  expect(host.textContent).not.toContain("Step status");
  expect(host.textContent).not.toContain("Try again");
  expect(host.querySelector("button")?.textContent).toContain("Check status");
  expect(retry).not.toHaveBeenCalled();
});

it("routes the canonical captured setup conflict to its affected step instead of retrying", async () => {
  const retry = vi.fn();
  const { host, router } = await renderInTestRouter(
    <RecordingProblem
      operation="run"
      error={
        new ApiError(
          409,
          "Saved target profile device:private-phone:1080x2340 has conflicting route-selection facts",
          {
            code: "target-profile-ambiguous",
            testId: "test-speed",
            stepId: "step-d950-source",
            diagnostics: [],
            recovery: "Open the test editor and resolve its blocking compile diagnostics.",
          },
        )
      }
      testContext={{ testId: "test-speed", appMapId: "grok-android" }}
      onRetry={retry}
      action={<button onClick={retry}>Try again</button>}
    />,
  );
  expect(host.textContent).toContain("Saved setup needs review");
  expect(host.textContent).not.toMatch(/private-phone|1080x2340|route-selection|Try again/u);
  const review = host.querySelector("a");
  expect(review?.textContent).toBe("Review affected step");
  await act(async () => {
    review?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(router.state.location.search).toEqual({ app: "grok-android", step: "step-d950-source" });
  expect(retry).not.toHaveBeenCalled();
});

it("opens the test without guessing an affected step when Relay supplies none", async () => {
  const { host, router } = await renderInTestRouter(
    <RecordingProblem
      recovery={{
        sourceCode: "target-profile-ambiguous",
        title: "Internal setup failure",
        detail: "private device facts",
        recovery: "Compile again",
        retryable: true,
      }}
      testContext={{ testId: "test-speed" }}
    />,
  );
  const review = host.querySelector("a");
  expect(review?.textContent).toBe("Review test");
  await act(async () => {
    review?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(router.state.location.search).toEqual({});
  expect(host.textContent).not.toContain("private device facts");
});

it("keeps browser selection recovery and its provided action", async () => {
  const host = await render(
    <RecordingProblem
      recovery={{
        sourceCode: "browser-target-profile-selection-required",
        title: "This browser’s setup changed since recording",
        detail: "This test was recorded with a different browser setup.",
        recovery:
          "Record the test again on this browser, or restore its previous setup in Devices.",
        retryable: false,
      }}
      action={<button>Review browser setup</button>}
    />,
  );
  expect(host.textContent).toContain("This browser’s setup changed since recording");
  expect(host.querySelector("button")?.textContent).toBe("Review browser setup");
  expect(host.textContent).not.toContain("Recorded screens disagree");
});

it("identifies a failed recording status read without claiming replay failed", async () => {
  const host = await render(
    <RecordingProblem
      reviewOperation="inspect"
      error={new TypeError("Failed to fetch")}
      onRetry={vi.fn()}
    />,
  );
  expect(host.textContent).toContain("Recording status is unavailable");
  expect(host.textContent).toContain("checking this recording");
  expect(host.querySelector("button")?.textContent).toContain("Check status");
  expect(host.querySelector("summary")?.textContent).toBe("Details");
  expect(host.textContent).toContain("Operation: Check recording status");
  expect(host.textContent).toContain("Code: local-service-transport");
  expect(host.textContent).not.toContain("Replay failed");
});

it("exposes only safe HTTP diagnostics for a recording action failure", async () => {
  const host = await render(
    <RecordingProblem
      reviewOperation="replay"
      error={
        new ApiError(500, "private prompt and native stack", {
          code: "ACTION_FAILED",
          message: "private prompt",
          stack: "private stack",
          requestId: "private invented correlation",
          details: { token: "private token" },
        })
      }
      onRetry={vi.fn()}
    />,
  );
  expect(host.textContent).toContain("Could not confirm the replay");
  expect(host.textContent).toContain("Operation: run recorded steps");
  expect(host.textContent).toContain("HTTP status: 500");
  expect(host.textContent).toContain("Code: ACTION_FAILED");
  expect(host.textContent).not.toMatch(/private|stack|correlation/u);
  expect(host.querySelector("button")?.textContent).toContain("Check status");
});

it("offers a read-only status check for an unexpected non-retryable action error", async () => {
  const check = vi.fn();
  const host = await render(
    <RecordingProblem
      reviewOperation="edit"
      error={new Error("unexpected private payload")}
      onRetry={check}
    />,
  );
  expect(host.textContent).toContain("Could not confirm the recording update");
  const button = host.querySelector("button");
  expect(button?.textContent).toContain("Check status");
  await act(async () => button?.click());
  expect(check).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("unexpected private payload");
});

it("omits unrecognized codes and preserves unsafe replay recovery", async () => {
  const host = await render(
    <RecordingProblem
      operation="replay"
      reviewOperation="replay"
      error={new ApiError(409, "private text", { code: "private-token-value" })}
      recovery={{
        code: "mutation-outcome-unknown",
        title: "Unknown",
        detail: "private receipt",
        recovery: "Inspect",
        retryable: false,
      }}
      onRetry={vi.fn()}
    />,
  );
  expect(host.textContent).toContain("Replay status needs checking");
  expect(host.textContent).not.toMatch(/private|Try again|Could not confirm the replay/u);
  expect(host.querySelector("button")?.textContent).toContain("Check status");
});

it("keeps uncertain review actions neutral unless replay is attributable", async () => {
  const recovery = {
    code: "mutation-outcome-unknown",
    title: "Unknown",
    detail: "Private",
    recovery: "Inspect",
    retryable: false,
  };
  const edit = await render(
    <RecordingProblem
      operation="replay"
      reviewOperation="edit"
      recovery={recovery}
      onRetry={vi.fn()}
    />,
  );
  expect(edit.textContent).toContain("Recording status needs checking");
  expect(edit.textContent).not.toContain("Replay status");
  const replay = await render(
    <RecordingProblem
      reviewOperation="inspect"
      recovery={{ ...recovery, action: "replay" }}
      error={new TypeError("Failed to fetch")}
      onRetry={vi.fn()}
    />,
  );
  expect(replay.textContent).toContain("Replay status needs checking");
  expect(replay.textContent).toContain("Could not refresh the recording status");
  expect(replay.textContent).toContain("Operation: Check recording status");
});
