import { expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { AppMapTestRunControl, type TestRunControlProps } from "./app-map-test-run-control";

function setup(overrides: Partial<TestRunControlProps> = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  root.style.width = "320px";
  document.body.append(root);
  const onRun = vi.fn();
  const onCancel = vi.fn();
  const onCheckOffline = vi.fn();
  const [startup, setStartup] = createSignal<TestRunControlProps["startup"]>({ mode: "cold" });
  const props: TestRunControlProps = {
    launchState: "idle",
    onRun,
    onCancel,
    onOpenResult: vi.fn(),
    onCheckOffline,
    freshEvidenceAvailable: true,
    freshEvidence: false,
    onFreshEvidenceChange: vi.fn(),
    startup: startup(),
    checkpointOptions: [{ screenId: "settings", label: "Settings" }],
    onStartupChange: (next) => setStartup(next),
    targetProfileOptions: [{ id: "ipad-en", label: "iPad · English" }],
    targetProfileId: "ipad-en",
    onTargetProfileChange: vi.fn(),
    ...overrides,
  };
  const dispose = render(() => <AppMapTestRunControl {...props} startup={startup()} />, root);
  return { root, dispose, onRun, onCancel, onCheckOffline };
}

test("keeps one primary Run action visible and places expert controls in one disclosure", () => {
  const view = setup();
  const actions = view.root.querySelector<HTMLElement>("[data-test-run-actions]")!;
  const details = actions.querySelector<HTMLDetailsElement>("[data-test-run-options]")!;
  const summary = details.querySelector<HTMLElement>("summary")!;
  const run = [...actions.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes("Run test"),
  )!;

  expect(details.open).toBe(false);
  expect(summary.textContent).toContain("Run options");
  expect(summary.tabIndex).toBe(0);
  expect(summary.className).toContain("min-h-11");
  expect(actions.className).toContain("flex");
  expect(actions.className).not.toContain("grid-cols");
  expect(run.getAttribute("data-variant")).toBe("primary");
  expect(run.className).toContain("shrink-0");
  expect(run.getAttribute("aria-label")).toBe("Run test");
  expect(run.textContent).toContain("Run");
  expect(details.querySelector("[data-test-startup-policy]")).not.toBeNull();
  expect(details.querySelector("[data-test-runtime-profile]")).not.toBeNull();
  expect(details.querySelector("[data-test-runtime-profile]")?.className).toContain("min-h-11");
  expect(details.textContent).toContain("Capture fresh evidence");
  expect(details.textContent).toContain("Run performs this check automatically");

  run.click();
  expect(view.onRun).toHaveBeenCalledTimes(1);
  expect(view.onCheckOffline).not.toHaveBeenCalled();
  view.dispose();
});

test("the disclosure opens from its keyboard-native summary and Escape restores focus", async () => {
  const view = setup();
  const details = view.root.querySelector<HTMLDetailsElement>("[data-test-run-options]")!;
  const summary = details.querySelector<HTMLElement>("summary")!;
  summary.focus();
  // Browsers synthesize this click for Enter/Space on a native summary. Calling
  // click here exercises the same activation path without replacing that native
  // keyboard behavior with a custom key handler.
  summary.click();
  expect(details.open).toBe(true);
  expect(summary.getAttribute("aria-expanded")).toBe("true");

  // Escape works from the summary itself, not only from a field in the panel.
  summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await Promise.resolve();
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(summary);

  summary.click();
  expect(details.open).toBe(true);

  const check = [...details.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes("Check offline"),
  )!;
  check.focus();
  check.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await Promise.resolve();
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(summary);
  view.dispose();
});

test("reserves the primary action footprint and announces complete recovery copy", () => {
  const recovery =
    "The selected target profile is no longer valid. Choose a matching evidence profile in Run options before running this Test.";
  const idle = setup();
  const idlePrimary = [...idle.root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes("Run test"),
  )!;
  const blocked = setup({
    blockedReason: recovery,
    blockedActionLabel: "Choose target variant",
    onResolveBlocked: vi.fn(),
  });
  const blockedPrimary = [...blocked.root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes("Choose target variant"),
  )!;
  const status = blocked.root.querySelector<HTMLElement>("[data-test-run-status]")!;

  expect(blockedPrimary.className).toBe(idlePrimary.className);
  expect(status.textContent).toBe(recovery);
  expect(status.className).toContain("sr-only");
  expect(status.getAttribute("aria-atomic")).toBe("true");

  idle.dispose();
  blocked.dispose();
});

test("active work keeps status plus Cancel visible while run options become inert", () => {
  const view = setup({
    job: { id: "job-1", action: "test", status: "running", queuedAt: 1, logs: [] },
  });
  const cancel = [...view.root.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes("Cancel run"),
  )!;
  expect(view.root.querySelector("[role='status']")?.textContent).toContain(
    "Running on the selected target",
  );
  expect(cancel.getAttribute("data-variant")).toBe("danger");
  cancel.click();
  expect(view.onCancel).toHaveBeenCalledTimes(1);
  expect(
    view.root.querySelector<HTMLButtonElement>("[data-test-run-options] button")?.disabled,
  ).toBe(true);
  view.dispose();
});
