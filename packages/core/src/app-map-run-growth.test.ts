import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { pathLabel, planRunGrowth } from "./app-map-run-growth.js";
import type { ObservedRunFrame } from "./app-map-observed.js";

function map(connections: AppMap["connections"] = {}): AppMap {
  return {
    id: "shop",
    projectId: "p",
    screens: {
      home: { id: "home", title: "Home", identity: { fingerprint: "fp-home" }, variantIds: [] },
    },
    screenVariants: {},
    connections,
  } as unknown as AppMap;
}

const frame = (fingerprint: string, at: number, titleGuess: string, stepTitle?: string) =>
  ({
    fingerprint,
    titleGuess,
    file: `${at}.png`,
    capturedAt: at,
    ...(stepTitle ? { stepTitle } : {}),
  }) satisfies ObservedRunFrame;

test("a run adds unknown screens and the moves between them as drafts", () => {
  const plan = planRunGrowth(map(), [
    frame("fp-home", 1, "Home"),
    frame("fp-cart", 2, "Cart", "Tap Cart"),
    frame("fp-cart-2", 3, "Cart"),
    frame("fp-pay", 4, "Payment", "Tap Pay"),
  ]);
  assert.equal(plan.screens.length, 2, "same-named frames share one screen");
  const [cart, pay] = plan.screens.map((item) => item.screenId);
  assert.match(cart!, /^observed-/);
  assert.deepEqual(
    plan.paths.map(({ fromScreenId, toScreenId, label }) => [fromScreenId, toScreenId, label]),
    [
      ["home", cart, "Tap Cart"],
      [cart, pay, "Tap Pay"],
    ],
  );
});

test("growth is idempotent: known screens and existing paths add nothing", () => {
  const first = planRunGrowth(map(), [frame("fp-home", 1, "Home"), frame("fp-cart", 2, "Cart")]);
  const cartId = first.screens[0]!.screenId;
  const grown = map({
    existing: {
      id: "existing",
      fromScreenId: "home",
      destination: { kind: "screen", screenId: cartId },
    } as AppMap["connections"][string],
  });
  grown.screens[cartId] = {
    id: cartId,
    title: "Cart",
    identity: { schemaVersion: 1, fingerprint: "fp-cart" },
    variantIds: [],
  } as unknown as AppMap["screens"][string];
  const again = planRunGrowth(grown, [frame("fp-home", 5, "Home"), frame("fp-cart", 6, "Cart")]);
  assert.deepEqual(again, { screens: [], paths: [] });
});

test("a screen named like exactly one map screen joins it instead of duplicating", () => {
  const plan = planRunGrowth(map(), [
    frame("fp-home", 1, "Home"),
    frame("fp-home-defect", 2, "home", "Reload"),
  ]);
  assert.deepEqual(plan, { screens: [], paths: [] });
});

test("draft paths never carry runner captions as their label", () => {
  assert.equal(pathLabel("Capture for review · step:check:The cart"), "Continue");
  assert.equal(pathLabel(undefined), "Continue");
  assert.equal(pathLabel("Tap “Settings”"), "Tap “Settings”");
});
