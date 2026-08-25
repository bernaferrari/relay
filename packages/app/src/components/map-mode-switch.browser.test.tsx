import { expect, test } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { MapModeSwitch, type MapMode } from "./map-mode-switch";

function setup(initial: MapMode = "map") {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const [value, setValue] = createSignal<MapMode>(initial);
  const dispose = render(() => <MapModeSwitch value={value()} onChange={setValue} />, root);
  return { root, dispose };
}

test("run-outcome mode is labelled Results, never Coverage", () => {
  const { root, dispose } = setup();
  const tab = root.querySelector<HTMLButtonElement>('[data-map-mode="coverage"]');
  expect(tab).not.toBeNull();
  expect(tab!.textContent).toContain("Results");
  expect(tab!.getAttribute("aria-label")).toBe("Results");
  expect(tab!.dataset.tip).toBe("What ran, and how it went");
  expect(root.textContent).not.toContain("Coverage");
  dispose();
});

test("the other modes keep their one-word labels", () => {
  const { root, dispose } = setup("screens");
  for (const [mode, label] of [
    ["map", "Canvas"],
    ["screens", "Screens"],
    ["test", "Test"],
  ] as const) {
    const tab = root.querySelector<HTMLButtonElement>(`[data-map-mode="${mode}"]`);
    expect(tab?.getAttribute("aria-label")).toBe(label);
  }
  dispose();
});
