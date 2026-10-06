/** @jsxImportSource react */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { StoryAction } from "../data/run-story";
import type { ProductRunReportOverview } from "../data/run-report-model";
import { RunStoryFailure } from "./run-story-failure";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
  }: {
    children: ReactNode;
    params: { testId: string };
    search: { step?: string; setup?: string };
  }) => <a href={`/tests/${params.testId}?${new URLSearchParams(search)}`}>{children}</a>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function render(
  action: StoryAction,
  testId?: string,
  report: Pick<ProductRunReportOverview, "outcome" | "failureCategory"> = {},
  onInspectEvidence = vi.fn(),
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RunStoryFailure
        step={{ id: "settings", title: "Settings layout", state: "failed", actions: [action] }}
        action={action}
        stepNumber={1}
        report={report}
        onInspectEvidence={onInspectEvidence}
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

it("inspects an unclassified failure before offering a secondary step edit", () => {
  const container = render(
    {
      id: "tap",
      kind: "tap",
      label: "Tap Save",
      state: "failed",
    },
    "test-settings",
  );
  expect(container.querySelector("button")?.textContent?.trim()).toBe("Inspect evidence");
  expect(container.querySelector("a")?.textContent).toBe("Edit step");
  expect(container.textContent).not.toContain("Fix this step");
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

it.each([
  ["product-failure", "deterministic-assertion", "Inspect evidence"],
  ["product-failure", "semantic-assertion", "Inspect evidence"],
  ["product-failure", "visual-assertion", "Inspect evidence"],
  ["product-failure", "locator", "Inspect evidence"],
  ["harness-failure", "locator", "Edit step"],
  ["harness-failure", "environment", "Repair setup"],
  ["harness-failure", "target-state", "Repair setup"],
  ["harness-failure", "action", "Inspect evidence"],
  ["harness-failure", "harness-defect", "Inspect evidence"],
  ["harness-failure", "unknown-category", "Inspect evidence"],
  ["uncertain", "locator", "Inspect evidence"],
  ["uncertain", "judge-uncertainty", "Inspect evidence"],
] as const)("offers %s / %s the recorded next action: %s", (outcome, failureCategory, primary) => {
  const inspect = vi.fn();
  const container = render(
    { id: "failed", kind: "check", label: "Check account balance", state: "failed" },
    "test-settings",
    { outcome, failureCategory },
    inspect,
  );
  expect(container.querySelector("button, a")?.textContent?.trim()).toBe(primary);
  expect(container.textContent).not.toContain("Fix this step");
  const edit = [...container.querySelectorAll("a")].find(
    (link) => link.textContent === "Edit step",
  );
  expect(edit?.getAttribute("href")).toBe("/tests/test-settings?step=settings");
  if (primary === "Repair setup")
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/tests/test-settings?setup=run",
    );
  if (primary === "Inspect evidence") {
    act(() => container.querySelector("button")!.click());
    expect(inspect).toHaveBeenCalledOnce();
  }
});

it("keeps evidence inspection available when the saved Test cannot be edited", () => {
  const container = render(
    { id: "tap", kind: "tap", label: "Tap Save", state: "failed" },
    undefined,
    { outcome: "harness-failure", failureCategory: "locator" },
  );
  expect(container.querySelector("button")?.textContent?.trim()).toBe("Inspect evidence");
  expect(container.querySelector("a")).toBeNull();
});
