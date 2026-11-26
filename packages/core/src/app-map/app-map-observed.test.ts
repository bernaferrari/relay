import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { guessScreenTitle, projectObservedRuns, type ObservedRun } from "./app-map-observed.js";

function map(): AppMap {
  const screen = (id: string, title: string, fingerprint: string) => ({
    id,
    title,
    identity: { fingerprint, aliases: [] },
  });
  return {
    id: "shop",
    projectId: "p",
    screens: {
      home: screen("home", "Home", "fp-home"),
      cart: screen("cart", "Cart", "fp-cart"),
      settings: screen("settings", "Settings", "fp-settings"),
    },
  } as unknown as AppMap;
}

const frame = (fingerprint: string, at: number, stepTitle?: string) => ({
  fingerprint,
  titleGuess: `Guess ${fingerprint}`,
  file: `${at}.png`,
  capturedAt: at,
  ...(stepTitle ? { stepTitle } : {}),
});

test("runs color known screens and keep unknown screens as new", () => {
  const runs: ObservedRun[] = [
    {
      runId: "r1",
      outcome: "passed",
      finishedAt: 10,
      frames: [frame("fp-home", 1), frame("fp-cart", 2, "Tap Cart")],
    },
    {
      runId: "r2",
      outcome: "product-failure",
      finishedAt: 20,
      frames: [frame("fp-home", 11), frame("fp-checkout", 12, "Tap Checkout")],
    },
  ];
  const observed = projectObservedRuns(map(), runs);
  const byKey = Object.fromEntries(observed.screens.map((screen) => [screen.key, screen]));
  assert.equal(byKey.home?.status, "seen"); // latest run failed, but not here
  assert.equal(byKey.home?.runCount, 2);
  assert.equal(byKey.cart?.status, "passing");
  assert.equal(byKey.settings?.status, "untested");
  assert.equal(byKey["new:fp-checkout"]?.status, "new");
  assert.equal(byKey["new:fp-checkout"]?.title, "Guess fp-checkout");
  assert.deepEqual(byKey["new:fp-checkout"]?.frame, {
    runId: "r2",
    file: "12.png",
    capturedAt: 12,
  });
  assert.deepEqual(observed.summary, { known: 3, tested: 2, failing: 0, new: 1 });
  assert.deepEqual(
    observed.transitions.map(({ fromKey, toKey, label }) => `${fromKey}>${toKey}:${label}`),
    ["home>cart:Tap Cart", "home>new:fp-checkout:Tap Checkout"],
  );
});

test("a run that stops on a known screen marks it failing", () => {
  const observed = projectObservedRuns(map(), [
    { runId: "r1", outcome: "passed", finishedAt: 1, frames: [frame("fp-cart", 1)] },
    {
      runId: "r2",
      outcome: "product-failure",
      finishedAt: 2,
      frames: [frame("fp-home", 2), frame("fp-cart", 3, "Tap Cart")],
    },
  ]);
  const cart = observed.screens.find((screen) => screen.key === "cart");
  assert.equal(cart?.status, "failing");
  assert.equal(cart?.lastRunId, "r2");
  assert.equal(observed.summary.failing, 1);
});

test("titles for new screens prefer headings over chrome", () => {
  assert.equal(
    guessScreenTitle([
      { label: "Back", type: "Button", rect: { x: 0, y: 0, width: 10, height: 10 } },
      { label: "Order summary", role: "heading", rect: { x: 0, y: 40, width: 10, height: 10 } },
    ]),
    "Order summary",
  );
  assert.equal(
    guessScreenTitle([
      { label: "Close", rect: { x: 0, y: 0, width: 1, height: 1 } },
      { label: "Total $84", rect: { x: 0, y: 90, width: 1, height: 1 } },
      { label: "Welcome back", rect: { x: 0, y: 20, width: 1, height: 1 } },
    ]),
    "Welcome back",
  );
  assert.equal(guessScreenTitle([]), "Untitled screen");
});

test("new screens with the same name share one card, and controls never name a screen", () => {
  const observed = projectObservedRuns(map(), [
    {
      runId: "r1",
      outcome: "passed",
      finishedAt: 1,
      frames: [
        { ...frame("fp-profile-a", 1), titleGuess: "Profile" },
        { ...frame("fp-profile-b", 2), titleGuess: "Profile" },
      ],
    },
  ]);
  assert.equal(observed.summary.new, 1);
  assert.equal(
    guessScreenTitle([
      {
        label: "12:41",
        bundleId: "com.android.systemui",
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
      { label: "Skip to main content", role: "link", rect: { x: 0, y: 5, width: 1, height: 1 } },
      { label: "Your account", rect: { x: 0, y: 30, width: 1, height: 1 } },
    ]),
    "Your account",
  );
});
