import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { AppMapTest } from "@relay/protocol";
import { TestSwitcher } from "./app-map-test-workspace-chrome";

const tests = [
  { id: "settings", name: "Settings", kind: "scenario", steps: [] },
  { id: "checkout", name: "Checkout", kind: "scenario", steps: [] },
] as unknown as AppMapTest[];

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("Test switcher separates dialog controls from its keyboard-navigable listbox", async () => {
  const onSelect = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <TestSwitcher
        tests={tests}
        selectedTestId="settings"
        name="Settings"
        busy={false}
        creating={false}
        onSelect={onSelect}
        onRename={() => undefined}
        onSource={() => undefined}
        onCreate={() => undefined}
        onDuplicate={() => undefined}
        onDelete={() => undefined}
      />
    ),
    root,
  );
  const trigger = root.querySelector<HTMLButtonElement>("#app-map-test-switcher")!;
  expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
  trigger.click();
  await settle();

  const dialog = root.querySelector<HTMLElement>('[role="dialog"][aria-label="Choose a Test"]')!;
  const listbox = dialog.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(listbox.querySelector('input, button:not([role="option"])')).toBeNull();
  expect(dialog.querySelector<HTMLInputElement>("#app-map-test-switcher-search")).not.toBeNull();
  expect(dialog.textContent).toContain("New Test");

  const search = dialog.querySelector<HTMLInputElement>("#app-map-test-switcher-search")!;
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.activeElement).toBe(
    listbox.querySelector<HTMLButtonElement>('[data-test-switcher-option="settings"]'),
  );
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "End", bubbles: true }),
  );
  const checkout = listbox.querySelector<HTMLButtonElement>(
    '[data-test-switcher-option="checkout"]',
  )!;
  expect(document.activeElement).toBe(checkout);
  checkout.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  checkout.click();
  await settle();
  expect(onSelect).toHaveBeenCalledWith("checkout");
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);

  dispose();
  root.remove();
});

test("Test options are absent when no selected Test can accept them", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <TestSwitcher
        tests={[]}
        selectedTestId=""
        name="Choose a Test"
        busy={false}
        creating={false}
        onSelect={() => undefined}
        onRename={() => undefined}
        onSource={() => undefined}
        onCreate={() => undefined}
        onDuplicate={() => undefined}
        onDelete={() => undefined}
      />
    ),
    root,
  );

  expect(root.querySelector('summary[aria-label="Test options"]')).toBeNull();
  dispose();
  root.remove();
});
