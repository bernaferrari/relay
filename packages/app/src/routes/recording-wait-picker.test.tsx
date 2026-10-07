import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import type { AuthoringInteraction } from "@relay/protocol";
import { RecordingWaitPicker } from "./recording-wait-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let onInsert: Mock<(interaction: AuthoringInteraction) => void>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onInsert = vi.fn<(interaction: AuthoringInteraction) => void>();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(canEdit = true) {
  await act(async () => root.render(<RecordingWaitPicker canEdit={canEdit} onInsert={onInsert} />));
}

function button(label: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button ${label} not found`);
  return found;
}

async function click(label: string, within?: ParentNode) {
  await act(async () => button(label, within).click());
}

async function openPicker() {
  await click("Wait before this step", host);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error("Wait dialog not found");
  return dialog;
}

async function fill(dialog: HTMLElement, value: string, seconds: string) {
  const fields = dialog.querySelectorAll<HTMLInputElement>("label > input");
  await act(async () => {
    [value, seconds].forEach((next, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        fields[index],
        next,
      );
      fields[index]!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

it("keeps appearance as the default and inserts a bounded label condition", async () => {
  await render();
  const dialog = await openPicker();
  expect(button("Appears", dialog).getAttribute("aria-pressed")).toBe("true");
  await click("Label", dialog);
  await fill(dialog, " Stop ", "15");
  await click("Add wait", dialog);
  expect(onInsert).toHaveBeenCalledExactlyOnceWith({
    kind: "steps",
    label: "Wait for Stop",
    steps: [{ kind: "wait-for", target: { label: "Stop" }, timeoutMs: 15000 }],
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("waits for a generating control to disappear with a bounded expect step", async () => {
  await render();
  const dialog = await openPicker();
  await click("Disappears", dialog);
  await fill(dialog, " generation.running ", "300");
  expect(button("Disappears", dialog).getAttribute("aria-pressed")).toBe("true");
  expect(dialog.textContent).toContain("already absent control continues immediately");
  await click("Add wait", dialog);
  expect(onInsert).toHaveBeenCalledExactlyOnceWith({
    kind: "steps",
    label: "Wait until generation.running disappears",
    steps: [
      {
        kind: "expect",
        condition: "gone",
        target: { identifier: "generation.running" },
        timeoutMs: 300_000,
      },
    ],
  });
});

it("accepts the 900-second maximum without turning it into a fixed pause", async () => {
  await render();
  const dialog = await openPicker();
  await click("Label", dialog);
  await fill(dialog, "Download", "900");
  expect(button("Add wait", dialog).disabled).toBe(false);
  await click("Add wait", dialog);
  expect(onInsert).toHaveBeenCalledExactlyOnceWith({
    kind: "steps",
    label: "Wait for Download",
    steps: [{ kind: "wait-for", target: { label: "Download" }, timeoutMs: 900_000 }],
  });
});

it.each([
  { reason: "above the maximum", value: "Download", seconds: "901" },
  { reason: "a blank budget", value: "Download", seconds: "" },
  { reason: "a zero budget", value: "Download", seconds: "0" },
  { reason: "a negative budget", value: "Download", seconds: "-1" },
  { reason: "an invalid budget", value: "Download", seconds: "not a number" },
  { reason: "a blank control", value: "   ", seconds: "300" },
  { reason: "an overlong control", value: "x".repeat(501), seconds: "300" },
])("does not insert with $reason", async ({ value, seconds }) => {
  await render();
  const dialog = await openPicker();
  await fill(dialog, value, seconds);
  expect(button("Add wait", dialog).disabled).toBe(true);
  await click("Add wait", dialog);
  expect(onInsert).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
});

it("prevents opening or inserting when editing is unavailable", async () => {
  await render(false);
  expect(button("Wait before this step", host).disabled).toBe(true);
  await click("Wait before this step", host);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render();
  const dialog = await openPicker();
  await fill(dialog, "Download", "300");
  expect(button("Add wait", dialog).disabled).toBe(false);
  await render(false);
  expect(button("Add wait", dialog).disabled).toBe(true);
  await click("Add wait", dialog);
  expect(onInsert).not.toHaveBeenCalled();
});
