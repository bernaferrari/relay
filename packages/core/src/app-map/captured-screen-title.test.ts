import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringObservation, RecipeStep } from "@relay/protocol";
import { newDestinationTitle } from "./captured-screen-title.js";

const tap = (label: string) => ({ kind: "tap", target: { label } }) as RecipeStep;
const after = (...labels: string[]) =>
  ({
    nodes: labels.map((label) => ({ role: "android.widget.Button", label })),
  }) as unknown as AuthoringObservation;

test("a tapped control that names a place names the new screen", () => {
  assert.equal(
    newDestinationTitle({ observed: "Settings", steps: [tap("Settings")], sourceTitle: "Home" }),
    "Settings",
  );
});

test("a tapped action never names the screen it opened", () => {
  assert.equal(
    newDestinationTitle({
      observed: "Send prompt",
      steps: [tap("Send prompt")],
      after: after("Copy message"),
      sourceTitle: "Chat",
    }),
    "Chat reply",
  );
  assert.equal(
    newDestinationTitle({ observed: undefined, steps: [tap("Send")], sourceTitle: "Chat" }),
    "Chat sent",
  );
  assert.notEqual(
    newDestinationTitle({ observed: undefined, steps: [], sourceTitle: "Start" }),
    "Next screen",
  );
});
