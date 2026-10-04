/** @jsxImportSource react */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { StoryAction } from "../data/run-story";
import { RunStoryFailure } from "./run-story-failure";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
  }: {
    children: ReactNode;
    params: { testId: string };
    search: { step: string };
  }) => <a href={`/tests/${params.testId}?step=${search.step}`}>{children}</a>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function render(action: StoryAction, testId?: string) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RunStoryFailure
        step={{ id: "settings", title: "Settings layout", state: "failed", actions: [action] }}
        action={action}
        stepNumber={1}
        {...(testId ? { testId } : {})}
      />,
    );
  });
  return container;
}

it("shows the proven product overlap and leaves raw selectors collapsed", () => {
  const container = render({
    id: "layout",
    kind: "check",
    label: "Check Team seats and Save do not overlap",
    state: "failed",
    failure: {
      kind: "layout-overlap",
      cause: "identifier team-seats overlaps identifier save-settings by 30×44 px",
      summary: "Team seats and Save overlap.",
      technicalDetail: "identifier team-seats overlaps identifier save-settings by 30×44 px",
    },
  });
  expect(container.querySelector("p")?.textContent).toContain("Team seats and Save overlap.");
  expect(container.querySelector("p")?.textContent).not.toMatch(/identifier|didn’t work/u);
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.querySelector("summary")?.textContent).toBe("Technical details");
  expect(container.querySelector("pre")?.textContent).toContain("identifier team-seats");
});

it("opens the check neutrally when the retained evidence proves a product overlap", () => {
  const container = render(
    {
      id: "layout",
      kind: "check",
      label: "Check Team seats and Save do not overlap",
      state: "failed",
      failure: { kind: "layout-overlap", summary: "Team seats and Save overlap." },
    },
    "test-settings",
  );
  expect(container.querySelector("a")?.textContent).toBe("View check");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    "/tests/test-settings?step=settings",
  );
  expect(container.textContent).not.toContain("Fix this step");
});

it("keeps the repair action for a failed step without proven product-overlap evidence", () => {
  const container = render(
    {
      id: "tap",
      kind: "tap",
      label: "Tap Save",
      state: "failed",
    },
    "test-settings",
  );
  expect(container.querySelector("a")?.textContent).toBe("Fix this step");
  expect(container.textContent).not.toContain("View check");
});

it("does not claim an overlap without proven assertion evidence", () => {
  const container = render({
    id: "layout",
    kind: "check",
    label: "Check elements do not overlap",
    state: "failed",
  });
  expect(container.querySelector("p")?.textContent).toContain("didn’t work.");
  expect(container.querySelector("p")?.textContent).not.toContain("The two elements overlap.");
  expect(container.querySelector("details")).toBeNull();
});
