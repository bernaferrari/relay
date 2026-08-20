import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import { AppMapCombineProfilePicker } from "./app-map-combine-profile-picker";
import type { CombineRuntimeProfileOption } from "../lib/app-map-combine-profiles";

const profiles: CombineRuntimeProfileOption[] = [
  { id: "pixel-en", name: "Pixel 9 · English", targetId: "serial-a", platform: "android" },
  { id: "pixel-it", name: "Pixel 9 · Italiano", targetId: "serial-a", platform: "android" },
  { id: "ipad-en", name: "iPad · English", targetId: "serial-b", platform: "ios" },
];

function mount(binding?: {
  testId: string;
  values: Record<string, string>;
  targetProfileId: string;
}) {
  const root = document.createElement("div");
  document.body.append(root);
  const onBind = vi.fn();
  const dispose = render(
    () => (
      <AppMapCombineProfilePicker
        testName="Settings tour"
        worldLabel="Italiano"
        values={{ language: "it" }}
        profiles={profiles}
        binding={binding}
        device={{ serial: "serial-a", platform: "android" }}
        onBind={onBind}
      />
    ),
    root,
  );
  return { root, onBind, dispose };
}

test("missing and bound cells keep a text status that is not color-only", () => {
  const missing = mount();
  expect(missing.root.textContent).toContain("Missing profile");
  expect(missing.root.querySelector("[data-combine-cell-status='missing']")).toBeTruthy();
  missing.dispose();

  const bound = mount({
    testId: "settings",
    values: { language: "it" },
    targetProfileId: "pixel-it",
  });
  expect(bound.root.textContent).toContain("Bound · Pixel 9 · Italiano");
  expect(bound.root.querySelector("[data-combine-cell-status='bound']")).toBeTruthy();
  bound.dispose();
});

test("suggestions appear without persisting a profile the person did not choose", () => {
  const view = mount();
  view.root.querySelector<HTMLButtonElement>("[data-combine-profile-trigger]")?.click();
  expect(view.root.textContent).toContain("Suggested · not bound until you choose");
  expect(view.root.textContent).toContain("matches it");
  expect(view.onBind).not.toHaveBeenCalled();
  const italian = [...view.root.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (option) => option.textContent?.includes("Italiano"),
  );
  italian?.click();
  expect(view.onBind).toHaveBeenCalledTimes(1);
  expect(view.onBind).toHaveBeenCalledWith("pixel-it");
  view.dispose();
});
