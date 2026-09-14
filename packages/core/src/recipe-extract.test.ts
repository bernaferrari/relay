import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  extractCurrentActionAssistantTurn,
  extractNewestCompletedAssistantTurn,
} from "./recipe-extract.js";
import { captureResponseBoundary } from "./recipe-response-boundary.js";

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

function quota(label: string): SnapshotNode {
  return { role: "text", label, visibleToUser: true };
}

const TARGET = { identifier: "assistant-message" };

test("old 4 plus new quota is not a verified new answer", () => {
  const leftover = [turn("4", "@old")];
  const boundary = captureResponseBoundary(leftover, "initiating-action", "ask-1");
  assert.throws(
    () =>
      extractNewestCompletedAssistantTurn(
        [turn("4", "@old"), quota("Try again in 10 minutes; no answer generated")],
        TARGET,
        boundary,
      ),
    /no verified new answer/u,
  );
});

test("old 4 plus new 5 fails an unchanged number-equals check", () => {
  const leftover = [turn("4", "@old")];
  const boundary = captureResponseBoundary(leftover, "initiating-action", "ask-1");
  const text = extractNewestCompletedAssistantTurn(
    [turn("4", "@old"), turn("5", "@new", 80)],
    TARGET,
    boundary,
  );
  assert.equal(text, "5");
});

test("old 4 plus a new identified 4 is a distinct current-action response", () => {
  const leftover = [turn("4", "@old")];
  const boundary = captureResponseBoundary(leftover, "initiating-action", "ask-1");
  const extracted = extractCurrentActionAssistantTurn(
    [turn("4", "@old"), turn("4", "@new", 80)],
    TARGET,
    boundary,
  );
  assert.equal(extracted.text, "4");
  assert.match(extracted.responseId, /@new/u);
  assert.equal(extracted.initiatingActionId, "ask-1");
});

test("missing extract target does not fall back to the rest of the page", () => {
  assert.throws(
    () => extractNewestCompletedAssistantTurn([turn("4", "@old")], { identifier: "missing-slot" }),
    /target did not match any node/u,
  );
});

test("reordered history does not pick an older answer by screen Y", () => {
  const leftover = [turn("4", "@old", 80)];
  const boundary = captureResponseBoundary(leftover, "initiating-action", "ask-1");
  const extracted = extractCurrentActionAssistantTurn(
    [turn("5", "@new", 420), turn("4", "@old", 80)],
    TARGET,
    boundary,
  );
  assert.equal(extracted.text, "5");
  assert.match(extracted.responseId, /@new/u);
});

test("without a boundary, quota plus a leftover completed turn is not current", () => {
  assert.throws(
    () =>
      extractNewestCompletedAssistantTurn(
        [turn("15", "@old"), quota("Free tier limit reached. Try again later.")],
        TARGET,
      ),
    /no verified new answer/u,
  );
});

test("without a boundary, two completed turns are not ordered by Y", () => {
  assert.throws(
    () =>
      extractNewestCompletedAssistantTurn(
        [turn("15", "@old", 240), turn("4", "@new", 420)],
        TARGET,
      ),
    /initiating-action boundary required/u,
  );
});

test("a single completed turn with no quota still extracts without a boundary", () => {
  assert.equal(extractNewestCompletedAssistantTurn([turn("5", "@only")], TARGET), "5");
});
