import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCombineCellTargetBinding } from "@relay/protocol";
import {
  bindingsForCombineCells,
  combineCellTargetBindingFor,
  isBoundLocalCombineTargetReady,
  localCombineTargetOptions,
  upsertCombineCellTargetBinding,
} from "./app-map-combine-targets";

const devices = [
  { serial: "pixel-a", name: "Pixel A", platform: "android" as const, booted: true },
  { serial: "ipad-b", name: "iPad B", platform: "ios" as const, booted: true },
  { serial: "browser-a", name: "Browser", platform: "browser" as const, booted: true },
  {
    serial: "offline-phone",
    name: "Offline phone",
    platform: "android" as const,
    connectionState: "offline" as const,
  },
];

test("local Combine targets expose attached Android/iOS lanes but never a browser or provider-shaped option", () => {
  const options = localCombineTargetOptions(devices, true);
  assert.deepEqual(
    options.map((option) => [option.target.kind, option.target.targetId, option.target.platform]),
    [
      ["local-device", "ipad-b", "ios"],
      ["local-device", "pixel-a", "android"],
      ["local-device", "offline-phone", "android"],
    ],
  );
  assert.equal(options.find((option) => option.target.targetId === "offline-phone")?.ready, false);
});

test("per-cell local target selection remains explicit and trims out-of-scope bindings", () => {
  const ready = localCombineTargetOptions(devices, true).filter((option) => option.ready);
  const pixel = ready.find((option) => option.target.targetId === "pixel-a");
  const ipad = ready.find((option) => option.target.targetId === "ipad-b");
  if (!pixel || !ipad) throw new Error("expected ready local targets");
  const english = { testId: "settings", values: { language: "en" } };
  const italian = { testId: "settings", values: { language: "it" } };
  const stale = { testId: "settings", values: { language: "fr" } };
  const bindings = upsertCombineCellTargetBinding(
    upsertCombineCellTargetBinding([], english, pixel.target),
    italian,
    ipad.target,
  );
  const replaced = upsertCombineCellTargetBinding(bindings, english, ipad.target);
  assert.equal(replaced.length, 2);
  assert.equal(combineCellTargetBindingFor(replaced, english)?.target.targetId, "ipad-b");
  const scoped = bindingsForCombineCells(replaced, [english, stale]);
  assert.deepEqual(
    scoped.map((binding: AppMapCombineCellTargetBinding) => binding.values.language),
    ["en"],
  );
});

test("a stale or not-ready bound target cannot make a local cell runnable", () => {
  const options = localCombineTargetOptions(devices, true);
  const ready = options.find((option) => option.target.targetId === "pixel-a");
  const unavailable = options.find((option) => option.target.targetId === "offline-phone");
  if (!ready || !unavailable) throw new Error("expected ready and unavailable fixture targets");
  const identity = { testId: "settings", values: { language: "it" } };
  const readyBinding = upsertCombineCellTargetBinding([], identity, ready.target)[0];
  const unavailableBinding = upsertCombineCellTargetBinding([], identity, unavailable.target)[0];

  assert.equal(isBoundLocalCombineTargetReady(readyBinding, options), true);
  assert.equal(isBoundLocalCombineTargetReady(unavailableBinding, options), false);
  assert.equal(isBoundLocalCombineTargetReady(readyBinding, []), false);
});
