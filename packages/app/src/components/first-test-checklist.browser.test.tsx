import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { FirstTestChecklistProps } from "./first-test-checklist";
import type { FirstTestChecklistState } from "../lib/onboarding";
import { FirstTestChecklist } from "./first-test-checklist";

function targetReady() {
  return {
    kind: "ready" as const,
    title: "Test browser is ready",
    detail: "Relay can now record or run an explicitly chosen Test on this Device.",
  };
}

function state(overrides: Partial<FirstTestChecklistState> = {}): FirstTestChecklistState {
  return {
    stage: "target",
    target: {
      kind: "offline",
      title: "Relay is offline",
      detail: "Reconnect Relay before choosing a Device or starting a Test.",
      actionLabel: "Reconnect Relay",
    },
    targetReady: false,
    screenSaved: false,
    testCreated: false,
    testReady: false,
    ...overrides,
  };
}

function setup(
  checklistState: FirstTestChecklistState,
  overrides: Partial<FirstTestChecklistProps> = {},
) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  root.style.width = "280px";
  document.body.append(root);
  const onTargetAction = vi.fn();
  const onShowLiveDevice = vi.fn();
  const onSaveStartScreen = vi.fn();
  const onCreateStarter = vi.fn();
  const onRecord = vi.fn();
  const onImportYaml = vi.fn();
  const onOpenTest = vi.fn();
  const onOpenReport = vi.fn();
  const onExportYaml = vi.fn();
  const onDismiss = vi.fn();
  const props: FirstTestChecklistProps = {
    state: checklistState,
    targetCheck: { state: "idle" },
    starterAvailable: false,
    creatingStarter: null,
    canSaveStartScreen: false,
    onTargetAction,
    onShowLiveDevice,
    onSaveStartScreen,
    onCreateStarter,
    onRecord,
    onImportYaml,
    onOpenTest,
    onOpenReport,
    onExportYaml,
    onDismiss,
    ...overrides,
  };
  const dispose = render(() => <FirstTestChecklist {...props} />, root);
  return {
    root,
    dispose,
    calls: {
      onTargetAction,
      onShowLiveDevice,
      onSaveStartScreen,
      onCreateStarter,
      onRecord,
      onImportYaml,
      onOpenTest,
      onOpenReport,
      onExportYaml,
      onDismiss,
    },
  };
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);
  if (!found) throw new Error(`Missing labelled button: ${label}`);
  return found;
}

test("target step exposes real preflight action without advancing local progress", () => {
  const view = setup(state(), {
    targetCheck: { state: "failed", detail: "Keep the browser open, then check again." },
  });
  expect(view.root.querySelector("[role='status']")?.textContent).toContain(
    "Keep the browser open",
  );
  button(view.root, "Reconnect Relay").click();
  expect(view.calls.onTargetAction).toHaveBeenCalledTimes(1);
  expect(view.calls.onSaveStartScreen).not.toHaveBeenCalled();
  expect(view.calls.onOpenTest).not.toHaveBeenCalled();
  expect(view.root.querySelector(".first-test-checklist")?.className).toContain("min-w-0");
  expect(view.root.textContent).toContain("Step 1 of 4");
  expect(
    view.root.querySelector("[aria-label='First useful Test progress: Step 1 of 4']"),
  ).not.toBeNull();
  expect(view.root.textContent).not.toContain("Not now");
  view.dispose();
});

test("authoring choices are explicit and a starter never triggers a run", () => {
  const view = setup(
    state({
      stage: "author",
      target: targetReady(),
      targetReady: true,
      screenSaved: true,
    }),
    { starterAvailable: true },
  );
  button(view.root, "Check starting state").click();
  button(view.root, "Start a blank Test").click();
  button(view.root, "Record Test").click();
  expect(view.calls.onCreateStarter).toHaveBeenNthCalledWith(1, "screen-check");
  expect(view.calls.onCreateStarter).toHaveBeenNthCalledWith(2, "blank");
  expect(view.calls.onRecord).toHaveBeenCalledTimes(1);
  expect(view.calls.onOpenTest).not.toHaveBeenCalled();
  expect(view.calls.onOpenReport).not.toHaveBeenCalled();
  expect(view.root.textContent).toContain("Step 3 of 4");
  expect(view.root.querySelector<HTMLInputElement>("input[type='file']")?.accept).toContain(
    ".yaml",
  );
  expect(view.root.textContent).not.toMatch(/\b(?:App Map|Take|Variable|Combine|campaign|lease)\b/);
  view.dispose();
});

test("persisted completion hands off to its report and records only an explicit dismissal", () => {
  const view = setup(
    state({
      stage: "complete",
      target: targetReady(),
      targetReady: true,
      screenSaved: true,
      testCreated: true,
      testReady: true,
      latestRun: { id: "report-1", status: "ok", writtenAt: 5 },
      completedRun: { id: "report-1", status: "ok", writtenAt: 5 },
    }),
  );
  button(view.root, "Open saved Report").click();
  button(view.root, "Export YAML").click();
  buttonByLabel(view.root, "Hide first useful test guide").click();
  expect(view.calls.onOpenReport).toHaveBeenCalledWith("report-1");
  expect(view.calls.onExportYaml).toHaveBeenCalledTimes(1);
  expect(view.calls.onDismiss).toHaveBeenCalledWith("completed");
  expect(view.root.textContent).toContain("Complete");
  view.dispose();
});
