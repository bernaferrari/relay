import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  captureResponseBoundary,
  listAssistantTurns,
  listQuotaObservations,
  turnsAfterBoundary,
} from "./recipe-response-boundary.js";

function turn(value: string, ref: string, y = 240): SnapshotNode {
  return {
    role: "article",
    label: "Grok",
    identifier: "assistant-message",
    value,
    ref,
    rect: { x: 200, y, width: 400, height: 48 },
    visibleToUser: true,
  };
}

const TARGET = { identifier: "assistant-message" };

test("identical consecutive answers keep distinct turn identities", () => {
  const turns = listAssistantTurns([turn("4", "@a"), turn("4", "@b", 80)]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.text, "4");
  assert.equal(turns[1]?.text, "4");
  assert.notEqual(turns[0]?.id, turns[1]?.id);
  assert.doesNotMatch(turns[0]?.id ?? "", /@a|@b/u);
});

test("a reminted leftover ref does not create a new turn after the initiating boundary", () => {
  const leftover = [turn("4", "@old")];
  const boundary = captureResponseBoundary(leftover, "initiating-action", "ask-1");
  assert.equal(turnsAfterBoundary([turn("4", "@reminted")], TARGET, boundary).length, 0);
});

test("same-node streaming is a new turn only while the text is still growing", () => {
  const partial = [turn("Hel", "@same")];
  const boundary = captureResponseBoundary(partial, "initiating-action", "ask-1");
  assert.equal(turnsAfterBoundary([turn("Hello", "@same")], TARGET, boundary).length, 1);
  const complete = captureResponseBoundary([turn("Hello", "@same")], "initiating-action", "ask-1");
  assert.equal(turnsAfterBoundary([turn("Hello", "@same")], TARGET, complete).length, 0);
});

test("quota banners are not assistant prose, even when the answer mentions a limit", () => {
  const answer = turn("The limit reached last month was expected", "@new");
  assert.equal(listQuotaObservations([answer]).length, 0);
  assert.equal(
    listQuotaObservations([
      answer,
      { role: "text", label: "Try again in 10 minutes; no answer generated", visibleToUser: true },
    ]).length,
    1,
  );
});

test("visible result controls are captured before input and cannot become a fresh turn", () => {
  for (const label of ["Copy message", " COPY\nMESSAGE ", "Copy message, previous answer"]) {
    const old = { label, role: "button", ref: "@old", visibleToUser: true };
    const boundary = captureResponseBoundary([old], "initiating-action", "ask-next");
    assert.equal(
      turnsAfterBoundary(
        [{ label: "Copy message", role: "button", ref: "@new" }],
        { label: "Copy message" },
        boundary,
      ).length,
      0,
      label,
    );
  }
});

test("a newly visible result control is fresh while hidden old controls are not evidence", () => {
  const hidden = { label: "Enhance Quality", visibleToUser: false };
  const boundary = captureResponseBoundary([hidden], "initiating-action", "ask-image");
  assert.equal(turnsAfterBoundary([hidden], { label: "Enhance Quality" }, boundary).length, 0);
  assert.equal(
    turnsAfterBoundary([{ ...hidden, visibleToUser: true }], { label: "Enhance Quality" }, boundary)
      .length,
    1,
  );
});
