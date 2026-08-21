import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { LocalCombineTargetOption } from "../lib/app-map-combine-targets";
import { AppMapCombineTargetPicker } from "./app-map-combine-target-picker";

const targets: LocalCombineTargetOption[] = [
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
  {
    target: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: "ipad-b",
      platform: "ios",
      identity: { kind: "device-serial", value: "ipad-b" },
    },
    label: "iPad B · iOS",
    detail: "Preparing… · ipad-b",
    ready: false,
  },
];

test("target selection stays explicit and rejects a not-ready lane", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const onBind = vi.fn();
  const dispose = render(
    () => (
      <AppMapCombineTargetPicker
        testName="Settings"
        worldLabel="Italian"
        targets={targets}
        onBind={onBind}
      />
    ),
    root,
  );
  expect(root.textContent).toContain("No local execution target");
  expect(root.querySelector("[data-combine-target-status='missing']")).toBeTruthy();
  const select = root.querySelector<HTMLSelectElement>("select")!;
  select.value = select.options[1]!.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  expect(onBind).toHaveBeenCalledWith(targets[0]!.target);
  expect(select.options[2]?.disabled).toBe(true);
  dispose();
  root.remove();
});
