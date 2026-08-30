import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";

vi.mock("../context/server", () => ({
  useServer: () => ({ selectedAppMapId: () => "map" }),
}));

vi.mock("../lib/golden-loop-telemetry", () => ({
  recordGoldenLoopHelp: vi.fn(),
}));

vi.mock("./studio-shell-workspaces", () => ({
  AppMapCombine: () => (
    <form data-combine-contents>
      <input aria-label="Repeat name" />
      <button type="button">Run Repeat</button>
    </form>
  ),
}));

import { StudioShellCombineRail } from "./studio-shell-combine-rail";
import { StudioShellShortcutsSheet } from "./studio-shell-shortcuts-sheet";

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

test("collapsed Repeat exposes one reopen control and makes its mounted panel inert", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const [collapsed, setCollapsed] = createSignal(false);
  const dispose = render(
    () => (
      <StudioShellCombineRail
        collapsed={collapsed()}
        onExpand={() => setCollapsed(false)}
        onOpenDevice={() => setCollapsed(true)}
        onOpenRun={() => undefined}
        onClose={() => undefined}
      />
    ),
    root,
  );
  await settle();

  const panel = root.querySelector<HTMLElement>("[data-combine-panel]")!;
  const input = panel.querySelector<HTMLInputElement>("input")!;
  input.focus();
  expect(document.activeElement).toBe(input);

  setCollapsed(true);
  await settle();
  const reopen = root.querySelector<HTMLButtonElement>('[aria-label="Open Repeat"]')!;
  expect(reopen).toBeTruthy();
  expect(panel.hasAttribute("inert")).toBe(true);
  expect(panel.getAttribute("aria-hidden")).toBe("true");
  expect(panel.querySelector("[data-combine-contents]")).toBeTruthy();
  expect(document.activeElement).toBe(reopen);

  reopen.click();
  await settle();
  expect(panel.hasAttribute("inert")).toBe(false);
  expect(panel.getAttribute("aria-hidden")).toBeNull();
  expect(root.querySelector('[aria-label="Open Repeat"]')).toBeNull();
  expect(document.activeElement).toBe(input);

  dispose();
  document.body.replaceChildren();
});

test("Keyboard Shortcuts traps focus, closes on Escape, and restores its opener", async () => {
  document.body.replaceChildren();
  const opener = document.createElement("button");
  opener.textContent = "Open Help";
  const root = document.createElement("div");
  document.body.append(opener, root);
  opener.focus();
  const [open, setOpen] = createSignal(true);
  const dispose = render(
    () => (
      <Show when={open()}>
        <StudioShellShortcutsSheet onClose={() => setOpen(false)} />
      </Show>
    ),
    root,
  );
  await settle();

  const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
  const close = dialog.querySelector<HTMLButtonElement>('[aria-label="Close shortcuts"]')!;
  expect(document.activeElement).toBe(close);

  close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  expect(dialog.contains(document.activeElement)).toBe(true);

  close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);

  dispose();
  document.body.replaceChildren();
});
