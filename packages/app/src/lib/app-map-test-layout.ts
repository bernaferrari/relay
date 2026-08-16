/**
 * Test workspace geometry.
 *
 * The old workspace encoded three viewport regimes in one arbitrary grid class,
 * and below 1120px the live device reflowed into a second grid *row* under the
 * other columns. That is the bug this module exists to make impossible: the
 * layout is always one row of three columns, and a rail can only change width
 * or become an overlay on its own edge.
 *
 * Width is measured on the workspace element rather than the viewport, because
 * the shell's map library can take ~280px without the viewport changing at all.
 */

export type TestLayoutMode = "wide" | "medium" | "narrow" | "compact";

/** How a rail occupies space. `strip` and `overlay` both stay on their edge. */
export type TestRailPresentation = "docked" | "strip" | "overlay";

export type TestRailKind = "steps" | "device";

/** Collapsed rails keep a labelled edge affordance instead of disappearing. */
export const TEST_RAIL_STRIP_WIDTH = 36;

const MODE_MIN_WIDTH: ReadonlyArray<readonly [TestLayoutMode, number]> = [
  ["wide", 1280],
  ["medium", 1024],
  ["narrow", 768],
];

const DOCKED_WIDTH: Record<TestLayoutMode, Record<TestRailKind, number>> = {
  wide: { steps: 288, device: 360 },
  medium: { steps: 248, device: 304 },
  narrow: { steps: 288, device: 272 },
  compact: { steps: 288, device: 272 },
};

/** Modes where a rail is docked in the grid rather than floated over it. */
const DOCKABLE: Record<TestRailKind, ReadonlySet<TestLayoutMode>> = {
  steps: new Set<TestLayoutMode>(["wide", "medium"]),
  device: new Set<TestLayoutMode>(["wide", "medium", "narrow"]),
};

export function testLayoutMode(width: number): TestLayoutMode {
  for (const [mode, min] of MODE_MIN_WIDTH) if (width >= min) return mode;
  return "compact";
}

/** Rails start open wherever they can dock, so no size hides the device. */
export function testRailOpensByDefault(rail: TestRailKind, mode: TestLayoutMode): boolean {
  return rail === "device" ? mode !== "compact" : DOCKABLE.steps.has(mode);
}

export function testRailPresentation(
  rail: TestRailKind,
  mode: TestLayoutMode,
  open: boolean,
): TestRailPresentation {
  if (!open) return "strip";
  return DOCKABLE[rail].has(mode) ? "docked" : "overlay";
}

/**
 * Width the rail contributes to the grid track. An overlay rail still owns its
 * strip, so the edge — and therefore the device — never disappears; only the
 * expanded panel floats over the editor.
 */
export function testRailTrack(rail: TestRailKind, mode: TestLayoutMode, open: boolean): string {
  const presentation = testRailPresentation(rail, mode, open);
  return presentation === "docked" ? `${DOCKED_WIDTH[mode][rail]}px` : `${TEST_RAIL_STRIP_WIDTH}px`;
}

/** Width an overlay rail uses when it floats over the editor. */
export function testRailOverlayWidth(rail: TestRailKind, containerWidth: number): string {
  const preferred = DOCKED_WIDTH.wide[rail];
  return `min(${preferred}px, calc(100% - ${containerWidth < 420 ? 48 : 72}px))`;
}

/**
 * The single grid template for the workspace. Three columns, one row, always in
 * the same order, so the device can never land underneath the editor.
 */
export function testWorkspaceColumns(
  mode: TestLayoutMode,
  open: { steps: boolean; device: boolean },
): string {
  return [
    testRailTrack("steps", mode, open.steps),
    "minmax(0,1fr)",
    testRailTrack("device", mode, open.device),
  ].join(" ");
}
