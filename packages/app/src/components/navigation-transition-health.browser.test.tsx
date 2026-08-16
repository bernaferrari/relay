import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import { navigationTransitionHealthModel } from "../lib/navigation-transition-health";
import { NavigationTransitionHealth } from "./navigation-transition-health";

test("navigation health renders proof, dependents, and one reviewable repair", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const onReviewRepair = vi.fn();
  const model = navigationTransitionHealthModel([
    {
      transitionId: "home-settings",
      authoredOrder: 1,
      source: { screenId: "home", title: "Home" },
      destination: { screenId: "settings", title: "Settings" },
      status: "proven",
      dependentCheckIds: ["usage", "advanced", "privacy"],
      observedAt: 2,
      proof: {
        tokenId: "proof-1",
        runId: "run-1",
        verifiedAt: 2,
        destination: { screenId: "settings", title: "Settings" },
      },
    },
    {
      transitionId: "settings-usage",
      authoredOrder: 2,
      source: { screenId: "settings", title: "Settings" },
      destination: { screenId: "usage", title: "Usage" },
      status: "drifted",
      dependentCheckIds: ["usage", "buy-more"],
      observedAt: 3,
      problem: { reason: "Usage row was absent" },
      repair: {
        targetId: "run-1:usage",
        sourceRunId: "run-1",
        checkId: "usage",
        title: "Repair Settings → Usage",
        summary: "Review the missing Usage locator.",
      },
    },
    {
      transitionId: "settings-advanced",
      authoredOrder: 3,
      source: { screenId: "settings", title: "Settings" },
      destination: { screenId: "advanced", title: "Advanced" },
      status: "ready",
      dependentCheckIds: ["advanced"],
      observedAt: 4,
    },
    {
      transitionId: "settings-privacy",
      authoredOrder: 4,
      source: { screenId: "settings", title: "Settings" },
      destination: { screenId: "privacy", title: "Privacy" },
      status: "blocked",
      dependentCheckIds: ["privacy", "data-controls"],
      observedAt: 5,
      problem: { reason: "Settings origin could not be reached" },
    },
  ]);
  const dispose = render(
    () => <NavigationTransitionHealth model={model} onReviewRepair={onReviewRepair} />,
    root,
  );

  expect(root.textContent).toContain("Home → Settings");
  expect(root.textContent).toContain("Last verified at Settings · 3 dependents");
  expect(root.textContent).toContain("Settings → Usage");
  expect(root.textContent).toContain("Drifted");
  expect(root.textContent).toContain("Settings → Advanced");
  expect(root.textContent).toContain("Ready");
  expect(root.textContent).toContain("Settings → Privacy");
  expect(root.textContent).toContain("Blocked");
  expect(root.textContent).toContain("Not verified in this lineage · 2 dependents");
  const review = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Review repair",
  )!;
  expect(review.disabled).toBe(false);
  review.click();
  expect(onReviewRepair).toHaveBeenCalledWith(model.repair);

  dispose();
  document.body.replaceChildren();
});
