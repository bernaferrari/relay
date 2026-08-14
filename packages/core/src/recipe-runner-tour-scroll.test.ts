import assert from "node:assert/strict";
import test from "node:test";
import {
  alignTourRowsAcrossReflow,
  matchesTourViewportCheckpoint,
  mergeTourViewportRows,
  tourViewportKey,
  visibleTourRow,
} from "./recipe-runner-tour-scroll.js";

test("merges overlapping translated viewports independent of row geometry", () => {
  const first = [
    { label: "Profilo", point: { x: 200, y: 220 } },
    { label: "Preferenze molto lunghe", point: { x: 200, y: 410 } },
    { label: "Voce", point: { x: 200, y: 690 } },
  ];
  const second = [
    { label: "Voce", point: { x: 200, y: 180 } },
    { label: "Conversazioni condivise", point: { x: 200, y: 390 } },
    { label: "Controllo dati", point: { x: 200, y: 620 } },
  ];
  assert.deepEqual(
    mergeTourViewportRows(first, second).map((stop) => stop.label),
    ["Profilo", "Preferenze molto lunghe", "Voce", "Conversazioni condivise", "Controllo dati"],
  );
});

test("viewport progress notices real movement but absorbs accessibility jitter", () => {
  const origin = [{ label: "Long row", point: { x: 200, y: 300 } }];
  assert.equal(
    tourViewportKey(origin),
    tourViewportKey([{ label: "Long row", point: { x: 202, y: 306 } }]),
  );
  assert.notEqual(
    tourViewportKey(origin),
    tourViewportKey([{ label: "Long row", point: { x: 200, y: 240 } }]),
  );
});

test("aligns selected translated rows through the complete recorded order", () => {
  const landmarks = [
    { label: "Profile" },
    { label: "NSFW Preferences" },
    { label: "Voice" },
    { label: "Shared Conversations" },
    { label: "Data Controls" },
  ];
  const live = [
    { label: "Profilo" },
    { label: "Preferenze NSFW su due righe" },
    { label: "Voce" },
    { label: "Conversazioni condivise" },
    { label: "Controllo dati" },
  ];
  const alignment = alignTourRowsAcrossReflow(live, landmarks.slice(1), landmarks);
  assert.equal(alignment.strategy, "recorded-order");
  assert.deepEqual(
    alignment.stops.map((stop) => stop.label),
    live.slice(1).map((stop) => stop.label),
  );
  assert.deepEqual(alignment.missingRequired, []);
});

test("uses a fully selected recorded list only after complete-list indexing", () => {
  const alignment = alignTourRowsAcrossReflow(
    [{ label: "Uno" }, { label: "Due su due righe" }, { label: "Tre" }],
    [{ label: "One" }, { label: "Two" }, { label: "Three" }],
  );
  assert.equal(alignment.strategy, "recorded-order");
  assert.deepEqual(
    alignment.stops.map((stop) => stop.label),
    ["Uno", "Due su due righe", "Tre"],
  );
});

test("refuses order alignment when locale exposes a different row set", () => {
  const landmarks = [{ label: "One" }, { label: "Two" }, { label: "Three" }];
  const alignment = alignTourRowsAcrossReflow(
    [{ label: "Uno" }, { label: "Experimental" }, { label: "Due" }, { label: "Tre" }],
    [{ label: "Two" }, { label: "Three", optional: true }],
    landmarks,
  );
  assert.deepEqual(alignment.stops, []);
  assert.deepEqual(
    alignment.missingRequired.map((stop) => stop.label),
    ["Two"],
  );
  assert.deepEqual(
    alignment.missingOptional.map((stop) => stop.label),
    ["Three"],
  );
});

test("stable identifiers survive translation and viewport checkpoints need real overlap", () => {
  assert.equal(
    visibleTourRow([{ label: "Conversazioni", identifier: "settings.shared" }], {
      label: "Shared conversations",
      identifier: "settings.shared",
    })?.label,
    "Conversazioni",
  );
  assert.equal(
    matchesTourViewportCheckpoint(
      [{ label: "Voce" }, { label: "Conversazioni" }],
      [{ label: "Voce" }, { label: "Conversazioni" }, { label: "Dati" }],
    ),
    true,
  );
  assert.equal(
    matchesTourViewportCheckpoint([{ label: "Voce" }], [{ label: "Voce" }, { label: "Dati" }]),
    false,
  );
});
