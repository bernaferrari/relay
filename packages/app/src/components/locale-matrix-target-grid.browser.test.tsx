import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { LocalExecutionTargetOption } from "../lib/local-execution-targets";
import { LocaleMatrixTargetGrid } from "./locale-matrix-target-grid";

const targets: LocalExecutionTargetOption[] = [
  {
    target: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: "pixel-a",
      platform: "android",
      identity: { kind: "device-serial", value: "pixel-a" },
    },
    label: "Pixel A · Android",
    detail: "Connected · pixel-a",
    ready: true,
  },
];

test("locale target cards preserve multiline labels and bind one exact frozen case", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const onBind = vi.fn();
  const cases = [
    { caseIndex: 0, locale: "English" },
    { caseIndex: 1, locale: "Português (Brasil)\nLong translated language name" },
    { caseIndex: 2, locale: "English" },
  ];
  const dispose = render(
    () => <LocaleMatrixTargetGrid cases={cases} bindings={[]} targets={targets} onBind={onBind} />,
    root,
  );
  try {
    expect(root.textContent).toContain("Português (Brasil)");
    expect(root.textContent).toContain("Long translated language name");
    expect(root.textContent).toContain("Restore");
    const cards = root.querySelectorAll("[data-locale-matrix-case]");
    expect(cards).toHaveLength(3);
    const grid = cards[0]?.parentElement;
    expect(grid?.className).toContain("sm:grid-cols-2");
    expect(grid?.className).toContain("xl:grid-cols-3");
    const secondSelect = cards[1]?.querySelector<HTMLSelectElement>("select");
    if (!secondSelect) throw new Error("expected second case target select");
    secondSelect.value = secondSelect.options[1]!.value;
    secondSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onBind).toHaveBeenCalledTimes(1);
    expect(onBind).toHaveBeenCalledWith(cases[1], targets[0]?.target);
  } finally {
    dispose();
    root.remove();
  }
});
