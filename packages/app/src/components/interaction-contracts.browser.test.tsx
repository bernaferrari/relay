import { expect, test } from "vitest";
import { Show, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import type { AppMapPrimaryAction } from "../lib/app-map-primary-action";
import { AppMapPrimaryActionButton } from "./app-map-primary-action-button";
import { RunsRefreshControl } from "./runs-refresh-control";
import { OfflineGate } from "./offline-gate";
import { CombineScreenshotDialog } from "./combine-review";
import { AppMapTestProposalReview } from "./app-map-test-proposal-review";
import type { AppMapScenarioTest, Proposal } from "@relay/protocol";
import { CommandPalette, CommandProvider, useCommand } from "../context/command";

const scenario: AppMapScenarioTest = {
  id: "checkout",
  organizationId: "org",
  projectId: "project",
  appMapId: "map",
  kind: "scenario",
  name: "Checkout",
  intentSchemaVersion: 1,
  steps: [],
  createdAt: 1,
  updatedAt: 1,
};

const proposal: Proposal = {
  id: "proposal",
  organizationId: "org",
  projectId: "project",
  appMapId: "map",
  baseRevision: 1,
  title: "Clarify checkout",
  status: "pending",
  changes: [
    {
      kind: "test.edit",
      testId: "checkout",
      edits: [
        { kind: "step.patch", stepId: "submit", patch: { intent: "Submit the reviewed order" } },
      ],
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

function installBrowser() {
  document.body.replaceChildren();
  return {
    window,
    restore() {
      document.body.replaceChildren();
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

test("primary action activates once while a blocked action remains focusable and inert", async () => {
  const browser = installBrowser();
  try {
    const root = browser.window.document.createElement("div");
    browser.window.document.body.append(root);
    let activations = 0;
    const action: AppMapPrimaryAction = {
      kind: "run",
      label: "Run path",
      reason: "Ready to run",
      icon: "play",
    };
    const dispose = render(
      () => (
        <AppMapPrimaryActionButton
          action={action}
          fallbackTip="Run this path"
          onActivate={() => (activations += 1)}
        />
      ),
      root,
    );
    const button = root.querySelector("button")!;
    button.click();
    expect(activations).toBe(1);
    expect(button.getAttribute("aria-disabled")).toBeNull();
    dispose();

    render(
      () => (
        <AppMapPrimaryActionButton
          action={{
            kind: "blocked",
            label: "Connecting…",
            reason: "Waiting for pixels",
            icon: "refresh",
          }}
          fallbackTip="Run this path"
          onActivate={() => (activations += 1)}
        />
      ),
      root,
    );
    const blocked = root.querySelector("button")!;
    blocked.focus();
    blocked.click();
    expect(browser.window.document.activeElement).toBe(blocked);
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect(activations).toBe(1);
  } finally {
    browser.restore();
  }
});

test("run refresh keeps saved results visible through failure and recovers", async () => {
  const browser = installBrowser();
  try {
    const root = browser.window.document.createElement("div");
    browser.window.document.body.append(root);
    let fail = true;
    render(
      () => (
        <RunsRefreshControl
          hasSavedResults
          refreshJobs={async () => (fail ? { ok: false, error: "jobs offline" } : { ok: true })}
          refreshRuns={async () => ({ ok: true })}
        />
      ),
      root,
    );
    root.querySelector("button")!.click();
    await new Promise((resolve) => setTimeout(resolve, 525));
    await settle();
    expect(root.textContent).toMatch(/Showing saved results/);
    expect(root.textContent).toMatch(/Retry refresh/);

    fail = false;
    root.querySelector("button")!.click();
    await new Promise((resolve) => setTimeout(resolve, 525));
    await settle();
    expect(root.textContent).not.toMatch(/Showing saved results/);
    expect(root.textContent).toMatch(/Updated/);
  } finally {
    browser.restore();
  }
});

test("offline interruption preserves work, owns focus, reports retry failure, and restores focus", async () => {
  const browser = installBrowser();
  try {
    const trigger = browser.window.document.createElement("button");
    const root = browser.window.document.createElement("div");
    browser.window.document.body.append(trigger, root);
    trigger.focus();
    const [offline, setOffline] = createSignal(false);
    render(
      () => (
        <OfflineGate
          connection={{
            isOffline: offline,
            serverUrl: () => "http://127.0.0.1:8787",
            retryConnection: async () => {
              throw new Error("Server still unavailable");
            },
          }}
        >
          <input aria-label="Unsaved test name" value="Checkout flow" />
        </OfflineGate>
      ),
      root,
    );
    setOffline(true);
    await settle();
    const dialog = root.querySelector<HTMLElement>('[role="alertdialog"]')!;
    const retry = dialog.querySelector<HTMLButtonElement>("button")!;
    expect(browser.window.document.activeElement).toBe(retry);
    expect(root.querySelector("input")?.value).toBe("Checkout flow");
    expect(root.firstElementChild?.firstElementChild?.hasAttribute("inert")).toBe(true);

    retry.click();
    await settle();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Server still unavailable");

    setOffline(false);
    await settle();
    expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    expect(root.querySelector("input")?.value).toBe("Checkout flow");
    expect(browser.window.document.activeElement).toBe(trigger);
  } finally {
    browser.restore();
  }
});

test("Combine screenshot dialog traps Tab and returns focus to its opener", async () => {
  const browser = installBrowser();
  try {
    const trigger = browser.window.document.createElement("button");
    const root = browser.window.document.createElement("div");
    browser.window.document.body.append(trigger, root);
    trigger.focus();
    const [open, setOpen] = createSignal(true);
    let closes = 0;
    render(
      () => (
        <Show when={open()}>
          <CombineScreenshotDialog
            title="Checkout"
            source="data:image/png;base64,iVBORw0KGgo="
            world="Default"
            values={[]}
            position={1}
            total={1}
            onOpenRun={() => undefined}
            onClose={() => {
              closes += 1;
              setOpen(false);
            }}
          />
        </Show>
      ),
      root,
    );
    await settle();
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = dialog.querySelector<HTMLButtonElement>('[aria-label="Close screenshot"]')!;
    expect(browser.window.document.activeElement).toBe(close);
    close.dispatchEvent(new browser.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(dialog.contains(browser.window.document.activeElement)).toBe(true);

    close.click();
    await settle();
    expect(closes).toBe(1);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(browser.window.document.activeElement).toBe(trigger);
  } finally {
    browser.restore();
  }
});

function PaletteFixture() {
  const commands = useCommand();
  const unregister = commands.register([
    { id: "first", title: "First command", group: "Test", run: () => undefined },
    { id: "second", title: "Second command", group: "Test", run: () => undefined },
  ]);
  onCleanup(unregister);
  return <CommandPalette />;
}

test("command palette tracks keyboard selection and restores focus after activation", async () => {
  const browser = installBrowser();
  try {
    const trigger = browser.window.document.createElement("button");
    trigger.textContent = "Open commands";
    const root = browser.window.document.createElement("div");
    browser.window.document.body.append(trigger, root);
    trigger.focus();
    render(
      () => (
        <CommandProvider>
          <PaletteFixture />
        </CommandProvider>
      ),
      root,
    );
    browser.window.dispatchEvent(
      new browser.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
    );
    await settle();
    const input = root.querySelector<HTMLInputElement>('[role="combobox"]')!;
    expect(input).toBeTruthy();
    expect(input.getAttribute("aria-activedescendant")).toMatch(/first$/);
    expect(browser.window.document.activeElement).toBe(input);
    input.dispatchEvent(new browser.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(
      root.querySelector('[role="dialog"]')?.contains(browser.window.document.activeElement),
    ).toBe(true);

    input.dispatchEvent(
      new browser.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await settle();
    expect(input.getAttribute("aria-activedescendant")).toMatch(/second$/);
    input.dispatchEvent(
      new browser.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(browser.window.document.activeElement).toBe(trigger);
  } finally {
    browser.restore();
  }
});

test("Test proposal review dialog traps Tab, closes on Escape, and restores focus", async () => {
  const browser = installBrowser();
  try {
    const trigger = browser.window.document.createElement("button");
    const root = browser.window.document.createElement("div");
    browser.window.document.body.append(trigger, root);
    trigger.focus();
    const [open, setOpen] = createSignal(true);
    let closes = 0;
    render(
      () => (
        <Show when={open()}>
          <AppMapTestProposalReview
            test={scenario}
            proposals={[proposal]}
            onApprove={() => undefined}
            onReject={() => undefined}
            onClose={() => {
              closes += 1;
              setOpen(false);
            }}
          />
        </Show>
      ),
      root,
    );
    await settle();
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Close Test proposal review"]',
    )!;
    expect(browser.window.document.activeElement).toBe(close);

    // Shift+Tab from the first focusable wraps back to the last control.
    close.dispatchEvent(
      new browser.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(dialog.contains(browser.window.document.activeElement)).toBe(true);

    browser.window.document.activeElement!.dispatchEvent(
      new browser.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    expect(closes).toBe(1);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(browser.window.document.activeElement).toBe(trigger);
  } finally {
    browser.restore();
  }
});
