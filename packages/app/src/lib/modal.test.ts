import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { focusFirstAndRestore, trapFocus } from "./modal";

test("modal focus starts on the safe action, wraps, and returns to its trigger", () => {
  const window = new Window();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, { window, document: window.document });
  try {
    const trigger = window.document.createElement("button");
    trigger.textContent = "Delete";
    const dialog = window.document.createElement("section");
    const cancel = window.document.createElement("button");
    cancel.textContent = "Cancel";
    const destructive = window.document.createElement("button");
    destructive.textContent = "Delete forever";
    dialog.append(cancel, destructive);
    window.document.body.append(trigger, dialog);
    Object.defineProperty(cancel, "offsetParent", { value: dialog });
    Object.defineProperty(destructive, "offsetParent", { value: dialog });
    trigger.focus();

    const release = trapFocus(dialog as unknown as HTMLElement);
    assert.equal(window.document.activeElement, cancel);

    destructive.focus();
    destructive.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    assert.equal(window.document.activeElement, cancel);

    release();
    assert.equal(window.document.activeElement, trigger);
  } finally {
    Object.assign(globalThis, { window: previousWindow, document: previousDocument });
    window.close();
  }
});

test("a non-modal interruption receives focus and restores the interrupted control", () => {
  const window = new Window();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, { window, document: window.document });
  try {
    const trigger = window.document.createElement("button");
    const interruption = window.document.createElement("section");
    const retry = window.document.createElement("button");
    retry.textContent = "Retry connection";
    interruption.append(retry);
    window.document.body.append(trigger, interruption);
    Object.defineProperty(retry, "offsetParent", { value: interruption });
    trigger.focus();

    const restore = focusFirstAndRestore(interruption as unknown as HTMLElement);
    assert.equal(window.document.activeElement, retry);

    restore();
    assert.equal(window.document.activeElement, trigger);
  } finally {
    Object.assign(globalThis, { window: previousWindow, document: previousDocument });
    window.close();
  }
});
