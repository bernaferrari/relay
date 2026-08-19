import assert from "node:assert/strict";
import test from "node:test";
import { corpusControls } from "./corpus-screen-analysis.js";
import type { SnapshotNode } from "./device.js";
import {
  isSystemInputNode,
  meaningfulNodeIndexes,
  systemInputNodeIndexes,
  wholeScreenNodeIndexes,
} from "./snapshot-app-content.js";

const FRAME = { x: 0, y: 0, width: 1112, height: 834 };

/**
 * The shape a physical iPad actually reports on Grok's Ask screen: an
 * Application/Window/container chain that is the only hittable thing on the
 * tree, SwiftUI rows underneath it at hittable:false, and — while a text field
 * is focused — the software keyboard presented as a sibling of the app's own
 * content, with genuinely hittable keys and its own unlabeled full-frame host.
 */
function iosAskScreen(composerLabel: string, options?: { keyboard?: boolean }): SnapshotNode[] {
  const app: SnapshotNode[] = [
    { index: 0, type: "Application", label: "Grok", hittable: true, rect: FRAME },
    { index: 1, parentIndex: 0, type: "Window", hittable: true, rect: FRAME },
    { index: 2, parentIndex: 0, type: "Other", hittable: true, rect: FRAME },
    {
      index: 3,
      parentIndex: 2,
      type: "Cell",
      label: composerLabel,
      hittable: false,
      rect: { x: 40, y: 120, width: 180, height: 44 },
      ref: "e4",
    },
    {
      index: 4,
      parentIndex: 2,
      type: "Cell",
      label: "Voice Mode",
      hittable: false,
      rect: { x: 40, y: 180, width: 180, height: 44 },
      ref: "e5",
    },
  ] as unknown as SnapshotNode[];
  if (options?.keyboard === false) return app;
  const keyboard: SnapshotNode[] = [
    // The host view: no label, no identifier, present only while the keyboard is.
    { index: 5, parentIndex: 0, type: "Other", rect: FRAME },
    { index: 6, parentIndex: 5, type: "Other", rect: { x: 0, y: 426, width: 1112, height: 408 } },
    {
      index: 7,
      parentIndex: 0,
      type: "Other",
      identifier: "SystemInputAssistantView",
      label: "Typing Predictions",
      hittable: true,
    },
    { index: 8, parentIndex: 7, type: "Other", label: "Ciao", hittable: true, ref: "e9" },
    {
      index: 9,
      parentIndex: 7,
      type: "Other",
      identifier: "RightButtonBar",
      label: "RightButtonBar",
      hittable: true,
    },
    { index: 10, parentIndex: 0, type: "Keyboard", label: "Q", hittable: true },
    {
      index: 11,
      parentIndex: 10,
      type: "Key",
      identifier: "delete",
      label: "elimina",
      hittable: true,
    },
    {
      index: 12,
      parentIndex: 10,
      type: "Button",
      identifier: "shift",
      label: "maiuscole",
      hittable: true,
    },
    { index: 13, parentIndex: 10, type: "Button", label: "Hide keyboard", hittable: true },
  ] as unknown as SnapshotNode[];
  return [...app, ...keyboard];
}

test("the software keyboard is not part of the app's control list", () => {
  const ignored = systemInputNodeIndexes(iosAskScreen("Expert"));
  // The assistant view with its predictions, the keyboard, and every key.
  for (const index of [7, 8, 9, 10, 11, 12, 13]) {
    assert.ok(ignored.has(index), `expected node ${index} to be system input`);
  }
  for (const index of [3, 4]) assert.ok(!ignored.has(index), "app rows are not system input");
});

test("a flattened tree still recognises keys without walking parents", () => {
  assert.ok(isSystemInputNode({ type: "Key", label: "a" } as SnapshotNode));
  assert.ok(isSystemInputNode({ type: "Keyboard" } as SnapshotNode));
  assert.ok(
    isSystemInputNode({ type: "Other", identifier: "SystemInputAssistantView" } as SnapshotNode),
  );
  assert.ok(!isSystemInputNode({ type: "Cell", label: "Voice Mode" } as SnapshotNode));
});

test("the application frame and any container filling it are not controls", () => {
  const covering = wholeScreenNodeIndexes(iosAskScreen("Expert"));
  for (const index of [0, 1, 2]) assert.ok(covering.has(index));
  for (const index of [3, 4]) assert.ok(!covering.has(index));
});

test("a snapshot with no frame element claims nothing covers the screen", () => {
  // A scoped or single-row capture: the only rect is the row's own. Treating the
  // biggest rect as the frame would delete the one control there is.
  const covering = wholeScreenNodeIndexes([
    {
      index: 0,
      type: "Cell",
      label: "Notifications",
      rect: { x: 0, y: 100, width: 220, height: 44 },
    },
  ] as unknown as SnapshotNode[]);
  assert.equal(covering.size, 0);
});

test("layout-only containers do not number the rows beside them", () => {
  const numbered = meaningfulNodeIndexes(
    iosAskScreen("Expert"),
    systemInputNodeIndexes(iosAskScreen("Expert")),
  );
  // The keyboard's unlabeled host says nothing and holds nothing that does.
  assert.ok(!numbered.has(5));
  assert.ok(!numbered.has(6));
  // A row and every ancestor it is reached through must still be numbered.
  for (const index of [0, 2, 3, 4]) assert.ok(numbered.has(index), `node ${index} carries a row`);
});

test("iOS rows survive as themselves when the app frame is the only hittable node", () => {
  // The regression that made the locale sweep unreadable: every row anchored on
  // the Application, so all of them collapsed into one control keyed by the app.
  const controls = corpusControls(iosAskScreen("Expert"));
  assert.deepEqual(
    controls.map((control) => control.label),
    ["Expert", "Voice Mode"],
  );
  assert.equal(controls[0]?.target.ref, "e4");
  assert.equal(controls[1]?.target.ref, "e5");
  assert.notEqual(controls[0]?.stableKey, controls[1]?.stableKey);
  assert.deepEqual(controls[0]?.rect, { x: 40, y: 120, width: 180, height: 44 });
});

test("an untranslated row is comparable across locales", () => {
  // The defect the sweep missed: the composer read "Esperto" in Italian and
  // "Expert" in pt-BR. Same stable key, different copy, so a comparison sees it.
  const italian = corpusControls(iosAskScreen("Esperto"))[0];
  const portuguese = corpusControls(iosAskScreen("Expert"))[0];
  assert.equal(italian?.stableKey, portuguese?.stableKey);
  assert.equal(italian?.label, "Esperto");
  assert.equal(portuguese?.label, "Expert");
});

test("keyboard copy cannot become a finding, in any keyboard language", () => {
  const labels = corpusControls(iosAskScreen("Esperto")).map((control) => control.label);
  for (const keyboard of ["elimina", "maiuscole", "Ciao", "Hide keyboard", "RightButtonBar"]) {
    assert.ok(!labels.includes(keyboard), `${keyboard} leaked into the control list`);
  }
});

test("a row keys the same whether or not the keyboard was up", () => {
  // Two locales can disagree about whether a text field took focus. If that
  // renumbered the rows, one row would read as two, and a translation diff would
  // be reported as a control that appeared and one that vanished.
  const focused = corpusControls(iosAskScreen("Expert", { keyboard: true }));
  const unfocused = corpusControls(iosAskScreen("Expert", { keyboard: false }));
  assert.deepEqual(
    focused.map((control) => control.stableKey),
    unfocused.map((control) => control.stableKey),
  );
});
