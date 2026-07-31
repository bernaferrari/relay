import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyMetadata } from "@relay/protocol";
import { createJourneyDocument } from "./journey-document";

const initial: JourneyMetadata = {
  schemaVersion: 4 as const,
  positions: { home: { x: 40, y: 80 } },
  edgeLabels: {},
  edgeKinds: {},
};

test("journey document keeps canvas edits reversible without mutating the seed", () => {
  const document = createJourneyDocument(initial);
  document.replace({ ...document.read(), screenTitles: { home: "Home" } });

  assert.equal(document.read().screenTitles?.home, "Home");
  assert.equal(document.canUndo(), true);
  assert.equal(initial.screenTitles, undefined);

  document.undoOnce();
  assert.equal(document.read().screenTitles, undefined);
  assert.equal(document.canRedo(), true);

  document.redoOnce();
  assert.equal(document.read().screenTitles?.home, "Home");
  document.destroy();
});
