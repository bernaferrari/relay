import assert from "node:assert/strict";
import test from "node:test";
import type { Recipe } from "./recipes.js";
import {
  appLocaleShouldRelaunch,
  stayAppLocaleDestinationCheck,
} from "./stay-app-locale-destination.js";

const fingerprint = "a".repeat(64);

function recipe(id: string, steps: Recipe["steps"]): Recipe {
  return { id, title: id, source: "custom", steps, createdAt: 1, updatedAt: 1 };
}

test("stay proves the last product expect-screen after a Home source", () => {
  const tour = recipe("tour", [
    {
      kind: "expect-screen",
      id: "relay-source-home",
      screenId: "home",
      screenTitle: "Home",
      fingerprint,
    },
    { kind: "tap", target: { label: "Data Controls" } },
    {
      kind: "expect-screen",
      id: "relay-destination-data",
      screenId: "data-controls",
      screenTitle: "Data Controls",
      fingerprint,
    },
  ]);
  assert.equal(appLocaleShouldRelaunch({}, { [tour.id]: tour }, tour.id), false);
  assert.deepEqual(stayAppLocaleDestinationCheck({ [tour.id]: tour }, tour.id), {
    kind: "expect-screen",
    id: "relay-destination-data-stay",
    screenId: "data-controls",
    screenTitle: "Data Controls",
    fingerprint,
  });
});

test("stay skips warm and recovery-only sources", () => {
  const recovery = recipe("tour:confirm:open-data", [
    {
      kind: "expect-screen",
      id: "relay-source-home",
      screenId: "home",
      screenTitle: "Home",
      fingerprint,
    },
  ]);
  const tour = recipe("tour", [
    {
      kind: "expect-screen",
      id: "home:warm",
      screenId: "home",
      screenTitle: "Home",
      fingerprint,
    },
    { kind: "module", recipeId: recovery.id },
    {
      kind: "expect-screen",
      id: "relay-destination-data",
      screenId: "data-controls",
      screenTitle: "Data Controls",
      fingerprint,
    },
  ]);
  const graph = { [tour.id]: tour, [recovery.id]: recovery };
  const stay = stayAppLocaleDestinationCheck(graph, tour.id);
  assert.equal(stay?.kind === "expect-screen" ? stay.screenId : undefined, "data-controls");
});

test("source-only graphs cannot stay and relaunch by default", () => {
  const setup = recipe("setup", [
    {
      kind: "expect-screen",
      id: "relay-source-home",
      screenId: "home",
      screenTitle: "Home",
      fingerprint,
    },
  ]);
  assert.equal(appLocaleShouldRelaunch({}, { [setup.id]: setup }, setup.id), true);
  assert.equal(stayAppLocaleDestinationCheck({ [setup.id]: setup }, setup.id), undefined);
});
