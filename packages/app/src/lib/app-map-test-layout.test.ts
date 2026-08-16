import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TEST_RAIL_STRIP_WIDTH,
  testLayoutMode,
  testRailOpensByDefault,
  testRailPresentation,
  testWorkspaceColumns,
  type TestLayoutMode,
} from "./app-map-test-layout";

const WIDTHS = [320, 480, 640, 700, 767, 768, 860, 1000, 1023, 1024, 1119, 1279, 1280, 1600, 2400];
const MODES: TestLayoutMode[] = ["wide", "medium", "narrow", "compact"];

test("layout mode is chosen from the measured container width", () => {
  assert.equal(testLayoutMode(320), "compact");
  assert.equal(testLayoutMode(767), "compact");
  assert.equal(testLayoutMode(768), "narrow");
  assert.equal(testLayoutMode(1023), "narrow");
  assert.equal(testLayoutMode(1024), "medium");
  assert.equal(testLayoutMode(1279), "medium");
  assert.equal(testLayoutMode(1280), "wide");
});

test("the workspace is always one row of three columns", () => {
  for (const width of WIDTHS) {
    const mode = testLayoutMode(width);
    for (const steps of [true, false]) {
      for (const device of [true, false]) {
        const tracks = testWorkspaceColumns(mode, { steps, device }).split(" ");
        assert.equal(tracks.length, 3, `${width}px / ${mode} produced ${tracks.join(" ")}`);
        assert.equal(tracks[1], "minmax(0,1fr)", "the editor is always the middle track");
      }
    }
  }
});

test("the device rail stays on the right edge at every width", () => {
  for (const width of WIDTHS) {
    const mode = testLayoutMode(width);
    const open = testRailPresentation("device", mode, true);
    assert.ok(
      open === "docked" || open === "overlay",
      `an opened device rail at ${width}px must dock or overlay, not ${open}`,
    );
    assert.equal(
      testRailPresentation("device", mode, false),
      "strip",
      `a closed device rail at ${width}px must keep its edge strip`,
    );
  }
});

test("a docked device rail keeps a real width and narrows as space shrinks", () => {
  const trackFor = (mode: TestLayoutMode) =>
    Number.parseInt(testWorkspaceColumns(mode, { steps: true, device: true }).split(" ")[2]!, 10);
  assert.equal(testRailPresentation("device", "wide", true), "docked");
  assert.equal(testRailPresentation("device", "medium", true), "docked");
  assert.equal(testRailPresentation("device", "narrow", true), "docked");
  assert.ok(trackFor("wide") > trackFor("medium"));
  assert.ok(trackFor("medium") > trackFor("narrow"));
  assert.ok(trackFor("narrow") >= 272);
});

test("a collapsed rail keeps a labelled strip instead of vanishing", () => {
  for (const mode of MODES) {
    assert.equal(testRailPresentation("steps", mode, false), "strip");
    assert.equal(testRailPresentation("device", mode, false), "strip");
    assert.equal(
      testWorkspaceColumns(mode, { steps: false, device: false }),
      `${TEST_RAIL_STRIP_WIDTH}px minmax(0,1fr) ${TEST_RAIL_STRIP_WIDTH}px`,
    );
  }
});

test("the steps rail yields to an overlay before the device rail does", () => {
  assert.equal(testRailPresentation("steps", "narrow", true), "overlay");
  assert.equal(testRailPresentation("device", "narrow", true), "docked");
  assert.equal(testRailPresentation("steps", "compact", true), "overlay");
  assert.equal(testRailPresentation("device", "compact", true), "overlay");
});

test("rails open by default wherever they can dock", () => {
  assert.deepEqual(
    MODES.map((mode) => testRailOpensByDefault("device", mode)),
    [true, true, true, false],
  );
  assert.deepEqual(
    MODES.map((mode) => testRailOpensByDefault("steps", mode)),
    [true, true, false, false],
  );
});

test("docked rails always leave the editor the larger share", () => {
  for (const width of WIDTHS) {
    const mode = testLayoutMode(width);
    const tracks = testWorkspaceColumns(mode, { steps: true, device: true }).split(" ");
    const rails = [tracks[0], tracks[2]]
      .map((track) => Number.parseInt(track ?? "0", 10))
      .reduce((sum, value) => sum + value, 0);
    assert.ok(rails < width / 2 + 96, `rails (${rails}px) crowd the editor at ${width}px`);
  }
});
