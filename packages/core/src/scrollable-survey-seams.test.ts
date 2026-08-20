import assert from "node:assert/strict";
import test from "node:test";
import { semanticViewportIsStationary } from "./scrollable-survey-seams.js";
import type { SnapshotPayload } from "./workspace-capture.js";

function settingsSnapshot(
  controls: Array<{
    label?: string;
    identifier?: string;
    type: string;
    y: number;
    index: number;
    parentIndex?: number;
  }>,
): SnapshotPayload {
  return {
    capturedAt: 1,
    foregroundApp: "ai.x.GrokApp",
    nodes: controls.map((control) => ({
      ...control,
      rect: { x: 0, y: control.y, width: 320, height: 24 },
      visibleToUser: true,
    })),
    interactive: [],
    bounds: { width: 320, height: 640 },
    inspectable: true,
    source: "sdk",
    screenIdentity: { fingerprint: "settings-fixture", nodes: [], volatileSignals: [] },
  };
}

test("does not mistake compact Settings chrome for a restored viewport", () => {
  const fixedShell = [
    { identifier: "app-root", type: "android.widget.FrameLayout", y: 0, index: 0 },
    {
      identifier: "settings-shell",
      type: "android.widget.LinearLayout",
      y: 56,
      index: 1,
      parentIndex: 0,
    },
    {
      identifier: "settings-list",
      type: "androidx.recyclerview.widget.RecyclerView",
      y: 112,
      index: 2,
      parentIndex: 1,
    },
    {
      identifier: "settings-compose",
      type: "androidx.compose.ui.platform.ComposeView",
      y: 164,
      index: 3,
      parentIndex: 1,
    },
    { identifier: "settings-toolbar", type: "Toolbar", y: 0, index: 4, parentIndex: 0 },
    { label: "Back", type: "Button", y: 12, index: 5, parentIndex: 0 },
    { label: "Settings", type: "Text", y: 20, index: 6, parentIndex: 0 },
    { label: "Save", type: "Button", y: 28, index: 7, parentIndex: 0 },
  ];

  assert.equal(
    semanticViewportIsStationary(
      settingsSnapshot([...fixedShell, { type: "Text", y: 120, index: 8, parentIndex: 2 }]),
      settingsSnapshot([...fixedShell, { type: "Text", y: 360, index: 8, parentIndex: 2 }]),
    ),
    false,
  );
});

test("accepts stationary Settings rows distributed through the viewport", () => {
  const rows = [
    { identifier: "app-root", type: "FrameLayout", y: 0, index: 0 },
    { identifier: "settings-list", type: "ScrollView", y: 56, index: 1, parentIndex: 0 },
    { label: "Appearance", type: "Text", y: 100, index: 2, parentIndex: 1 },
    { label: "Haptics", type: "Text", y: 180, index: 3, parentIndex: 1 },
    { label: "Advanced", type: "Text", y: 280, index: 4, parentIndex: 1 },
  ];
  assert.equal(semanticViewportIsStationary(settingsSnapshot(rows), settingsSnapshot(rows)), true);
});

test("does not certify fixed Android bottom navigation when list semantics are absent", () => {
  const shell = [
    { identifier: "app-root", type: "android.widget.FrameLayout", y: 0, index: 0 },
    {
      identifier: "content-list",
      type: "android.widget.ScrollView",
      y: 56,
      index: 1,
      parentIndex: 0,
    },
    // The list did move, but its provider exposed no semantic key for these
    // content descendants. Fixed app chrome must not substitute for it.
    { type: "android.widget.TextView", y: 140, index: 2, parentIndex: 1 },
    { identifier: "toolbar", type: "Toolbar", y: 0, index: 3, parentIndex: 0 },
    { label: "Back", type: "ImageButton", y: 12, index: 4, parentIndex: 0 },
    { label: "Home", type: "ImageButton", y: 500, index: 5, parentIndex: 0 },
    { label: "Recents", type: "ImageButton", y: 584, index: 6, parentIndex: 0 },
  ];
  assert.equal(
    semanticViewportIsStationary(
      settingsSnapshot(shell),
      settingsSnapshot(shell.map((node) => (node.index === 2 ? { ...node, y: 300 } : node))),
    ),
    false,
  );
});
