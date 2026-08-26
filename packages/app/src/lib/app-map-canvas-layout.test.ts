import assert from "node:assert/strict";
import test from "node:test";
import type { MapTreeNode } from "./app-map-tree";
import { compactCanvasPositions } from "./app-map-auto-layout";
import {
  connectorAutoLanes,
  connectorHasAutomaticSourceLane,
  connectorPresentationWithAutoLane,
} from "./app-map-connector-lanes";
import {
  canvasBounds,
  canvasEdgeArrowPath,
  canvasEdgeStartArrowPath,
  canvasEdgeGeometry,
  autoConnectorPortPair,
  connectorTargetGapForViewport,
  fitCanvasViewport,
  nextBranchPosition,
  openCanvasViewport,
  pointInDisplayedFrame,
  screenCardGeometry,
  screenFrameBounds,
  screenMediaBounds,
  SCREEN_FRAME_HEIGHT,
  SCREEN_CARD_WIDTH,
  clampCanvasScale,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
} from "./app-map-canvas-layout";

const start: MapTreeNode = {
  // Geometry is independent from persistence and target dimensions.
  id: "start",
  screenKey: "start",
  title: "Start",
  representativeStepIndex: -1,
  stepIndexes: [],
  depth: 0,
  x: 0,
  y: 0,
};
const settings: MapTreeNode = { ...start, id: "settings", title: "Settings", x: 320, y: 84 };

function pathEntersFrame(
  points: ReadonlyArray<{ x: number; y: number }>,
  frame: { left: number; top: number; right: number; bottom: number },
): boolean {
  return points.some((point, index) => {
    if (!index) return false;
    const previous = points[index - 1]!;
    if (previous.x === point.x) {
      if (point.x <= frame.left || point.x >= frame.right) return false;
      return (
        Math.max(previous.y, point.y) > frame.top && Math.min(previous.y, point.y) < frame.bottom
      );
    }
    if (previous.y === point.y) {
      if (point.y <= frame.top || point.y >= frame.bottom) return false;
      return (
        Math.max(previous.x, point.x) > frame.left && Math.min(previous.x, point.x) < frame.right
      );
    }
    return true;
  });
}

function pathsHaveProperCrossing(
  left: ReadonlyArray<{ x: number; y: number }>,
  right: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  for (let leftIndex = 1; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex - 1]!;
    const leftEnd = left[leftIndex]!;
    const leftVertical = leftStart.x === leftEnd.x;
    for (let rightIndex = 1; rightIndex < right.length; rightIndex += 1) {
      const rightStart = right[rightIndex - 1]!;
      const rightEnd = right[rightIndex]!;
      const rightVertical = rightStart.x === rightEnd.x;
      if (leftVertical === rightVertical) continue;
      const verticalStart = leftVertical ? leftStart : rightStart;
      const verticalEnd = leftVertical ? leftEnd : rightEnd;
      const horizontalStart = leftVertical ? rightStart : leftStart;
      const horizontalEnd = leftVertical ? rightEnd : leftEnd;
      const crossesVertical =
        (horizontalStart.x < verticalStart.x && verticalStart.x < horizontalEnd.x) ||
        (horizontalEnd.x < verticalStart.x && verticalStart.x < horizontalStart.x);
      const crossesHorizontal =
        (verticalStart.y < horizontalStart.y && horizontalStart.y < verticalEnd.y) ||
        (verticalEnd.y < horizontalStart.y && horizontalStart.y < verticalStart.y);
      if (crossesVertical && crossesHorizontal) return true;
    }
  }
  return false;
}

type CubicSegment = {
  control1: { x: number; y: number };
  control2: { x: number; y: number };
  end: { x: number; y: number };
};

function cubicSegments(path: string): CubicSegment[] {
  return [
    ...path.matchAll(/ C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)/g),
  ].map((match) => ({
    control1: { x: Number(match[1]), y: Number(match[2]) },
    control2: { x: Number(match[3]), y: Number(match[4]) },
    end: { x: Number(match[5]), y: Number(match[6]) },
  }));
}

function sampledPathEntersFrame(
  points: ReadonlyArray<{ x: number; y: number }>,
  frame: { left: number; top: number; right: number; bottom: number },
): boolean {
  return points.some(
    (point) =>
      point.x > frame.left &&
      point.x < frame.right &&
      point.y > frame.top &&
      point.y < frame.bottom,
  );
}

test("canvas geometry is total while a graph is mid-edit", () => {
  assert.equal(
    canvasEdgeGeometry(
      { from: "missing", to: "settings", kind: "forward" },
      [start, settings],
      (node) => node,
    ).path,
    "",
  );
  const geometry = canvasEdgeGeometry(
    { from: "start", to: "settings", kind: "forward" },
    [start, settings],
    (node) => node,
  );
  assert.match(geometry.path, new RegExp(`^M ${SCREEN_CARD_WIDTH} 117 L`));
  assert.match(geometry.path, / Q /);
  assert.doesNotMatch(geometry.path, / C /);
});

test("connector arrows share scene geometry with the route as 45-degree line arrows", () => {
  assert.equal(
    canvasEdgeArrowPath(
      {
        endPoint: { x: 20, y: 10 },
        hitPoints: [
          { x: 0, y: 10 },
          { x: 20, y: 10 },
        ],
      },
      2,
    ),
    "M 12.25 17.75 L 20 10 L 12.25 2.25",
  );
  assert.equal(
    canvasEdgeArrowPath({ endPoint: { x: 20, y: 10 }, hitPoints: [{ x: 20, y: 10 }] }),
    "",
  );
  // An invalid future analytic tangent still falls back to hit geometry rather
  // than producing a NaN arrowhead.
  assert.equal(
    canvasEdgeArrowPath({
      endPoint: { x: 20, y: 10 },
      endTangentPoint: { x: 20, y: 10 },
      hitPoints: [
        { x: 0, y: 10 },
        { x: 20, y: 10 },
      ],
    }),
    "M 12.25 17.75 L 20 10 L 12.25 2.25",
  );
  assert.equal(
    canvasEdgeStartArrowPath(
      {
        startPoint: { x: 0, y: 10 },
        hitPoints: [
          { x: 0, y: 10 },
          { x: 20, y: 10 },
        ],
      },
      2,
    ),
    "M 7.75 2.25 L 0 10 L 7.75 17.75",
  );
  assert.equal(
    canvasEdgeArrowPath(
      {
        endPoint: { x: 10, y: 20 },
        hitPoints: [
          { x: 10, y: 0 },
          { x: 10, y: 20 },
        ],
      },
      2,
    ),
    "M 2.25 12.25 L 10 20 L 17.75 12.25",
  );

  // A diagonal terminal yields horizontal and vertical wings of equal
  // projection, which is the same 45° line-arrow geometry in its local
  // tangent frame.
  const diagonal = canvasEdgeArrowPath(
    {
      endPoint: { x: 20, y: 20 },
      hitPoints: [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
      ],
    },
    2,
  )
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map(Number);
  assert.equal(diagonal?.length, 6);
  assert.ok(Math.abs(diagonal![1]! - 20) < 0.0001);
  assert.ok(Math.abs(diagonal![4]! - 20) < 0.0001);
  assert.ok(Math.abs(20 - diagonal![0]! - (20 - diagonal![5]!)) < 0.0001);
});

test("screen previews preserve phone and tablet viewport silhouettes", () => {
  const phone = screenCardGeometry({ logicalViewport: { width: 1080, height: 2340 } });
  const tablet = screenCardGeometry({ logicalViewport: { width: 1112, height: 834 } });

  assert.ok(phone.frameHeight > phone.frameWidth);
  assert.equal(phone.frameWidth, phone.mediaWidth);
  assert.equal(phone.mediaHeight, phone.frameHeight);
  assert.ok(tablet.frameWidth > tablet.frameHeight);
  assert.equal(phone.frameHeight, SCREEN_FRAME_HEIGHT);
  assert.equal(tablet.frameWidth, SCREEN_CARD_WIDTH);
  assert.equal(tablet.mediaWidth, tablet.frameWidth);
  assert.ok(phone.frameLeft > 0);
});

test("connections attach to the visible screen frame instead of its layout slot", () => {
  const phoneGeometry = () =>
    screenCardGeometry({ logicalViewport: { width: 1080, height: 2340 } });
  const path = canvasEdgeGeometry(
    { from: "start", to: "settings", kind: "forward" },
    [start, settings],
    (node) => node,
    undefined,
    phoneGeometry,
  ).path;
  const rightEdge = phoneGeometry().frameLeft + phoneGeometry().frameWidth;

  assert.match(path, new RegExp(`^M ${rightEdge}`));
});

test("automatic port pairs preserve a horizontal diagram's semantic side", () => {
  const phone = screenCardGeometry({ logicalViewport: { width: 1080, height: 2340 } });
  const source = screenFrameBounds({ x: 0, y: 0 }, phone);
  const sideBySide = screenFrameBounds({ x: 320, y: 0 }, phone);
  const farBelow = screenFrameBounds({ x: 320, y: 720 }, phone);

  assert.deepEqual(autoConnectorPortPair(source, sideBySide), {
    source: "right",
    target: "left",
  });
  // A lower target is still part of the rightward flow while its visible
  // frame is wholly right of the source. Routing can optimize its backbone,
  // but it must not silently move the arrow to the target's top edge.
  assert.deepEqual(autoConnectorPortPair(source, farBelow), {
    source: "right",
    target: "left",
  });
});

test("recorded connections can leave from the captured interaction point", () => {
  const path = canvasEdgeGeometry(
    {
      from: "start",
      to: "settings",
      kind: "forward",
      sourceAnchor: { point: { x: 0.25, y: 0.7 } },
    },
    [start, settings],
    (node) => node,
  ).path;
  assert.match(path, /^M 60 151\.8 L/);
});

test("recorded origins stay on the actual portrait screenshot and survive a port override", () => {
  const phoneGeometry = () =>
    screenCardGeometry({ logicalViewport: { width: 1080, height: 2340 } });
  const media = screenMediaBounds(start, phoneGeometry());
  const geometry = canvasEdgeGeometry(
    {
      from: "start",
      to: "settings",
      kind: "forward",
      sourceAnchor: { point: { x: 0.25, y: 0.7 } },
      presentation: { sourcePort: "bottom" },
    },
    [start, settings],
    (node) => node,
    undefined,
    phoneGeometry,
  );

  assert.equal(media.left, phoneGeometry().frameLeft);
  assert.ok(
    Math.abs(geometry.startPoint.x - (media.left + (media.right - media.left) * 0.25)) < 0.001,
  );
  assert.ok(
    Math.abs(geometry.startPoint.y - (media.top + (media.bottom - media.top) * 0.7)) < 0.001,
  );
});

test("vertically stacked screens connect bottom to top", () => {
  const below = { ...settings, id: "below", x: 0, y: 400 };
  const geometry = canvasEdgeGeometry(
    { from: "start", to: "below", kind: "forward" },
    [start, below],
    (node) => node,
  );

  assert.deepEqual(geometry.startPoint, { x: 120, y: 204 });
  assert.equal(geometry.path, "M 120 204 L 120 418");
});

test("connections can travel upward through top and bottom ports", () => {
  const below = { ...settings, id: "below", x: 0, y: 400 };
  const geometry = canvasEdgeGeometry(
    { from: "below", to: "start", kind: "forward" },
    [start, below],
    (node) => node,
  );

  assert.deepEqual(geometry.startPoint, { x: 120, y: 430 });
  assert.equal(geometry.path, "M 120 430 L 120 216");
});

test("automatic connectors route around intervening screens without entering them", () => {
  const blocker = { ...settings, id: "blocker", x: 320, y: 0 };
  const target = { ...settings, id: "target", x: 640, y: 0 };
  const before = canvasEdgeGeometry(
    { from: "start", to: "target", kind: "forward" },
    [start, blocker, target],
    (node) => node,
  );
  const after = canvasEdgeGeometry(
    { from: "start", to: "target", kind: "forward" },
    [start, { ...blocker, y: 3 }, target],
    (node) => node,
  );

  assert.deepEqual(before.startPoint, { x: 240, y: 117 });
  assert.match(before.path, /^M 240 117 L /);
  assert.match(before.path, / Q /);
  assert.doesNotMatch(before.path, / C /);
  assert.equal(
    pathEntersFrame(before.hitPoints, { left: 320, top: 30, right: 560, bottom: 204 }),
    false,
  );
  assert.equal(
    pathEntersFrame(after.hitPoints, { left: 320, top: 33, right: 560, bottom: 207 }),
    false,
  );
});

test("a packed fan arrives from the corridor rails, not from its siblings' edges", () => {
  // Terminal screens packed side by side share a row, so the connector into a
  // later column has to reach it past the cards in front of it. If that arrival
  // began at the card to its left, a wrapped fan would read as a chain of
  // screens nobody recorded. The rails in the gaps are what keep the shape
  // honest, so they are asserted on the real tidy geometry.
  const fan = ["appearance", "memory", "haptics", "usage", "advanced", "widget", "skills"];
  const ids = ["settings", ...fan, "import", "always-ask"];
  const positions = compactCanvasPositions({
    screens: ids.map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: [
      ...fan.map((id, index) => ({
        fromScreenId: "settings",
        destination: { kind: "screen" as const, screenId: id },
        sourceAnchor: { point: { x: 0.5, y: (index + 1) / (fan.length + 1) } },
      })),
      {
        fromScreenId: "memory",
        destination: { kind: "screen" as const, screenId: "import" },
        sourceAnchor: { point: { x: 0.5, y: 0.5 } },
      },
      {
        fromScreenId: "advanced",
        destination: { kind: "screen" as const, screenId: "always-ask" },
        sourceAnchor: { point: { x: 0.5, y: 0.5 } },
      },
    ],
  });
  const nodes = ids.map((id) => ({
    ...start,
    id,
    screenKey: id,
    title: id,
    x: positions[id]!.x,
    y: positions[id]!.y,
  }));
  const frameOf = (id: string) => screenFrameBounds(positions[id]!, screenCardGeometry());
  const arrivalX = (from: string, to: string) => {
    const geometry = canvasEdgeGeometry({ from, to, kind: "forward" }, nodes, (node) => node);
    for (const other of ids) {
      if (other === to || other === from) continue;
      assert.equal(
        pathEntersFrame(geometry.hitPoints, frameOf(other)),
        false,
        `the connector from ${from} into ${to} paints through ${other}`,
      );
    }
    return geometry.hitPoints[geometry.hitPoints.length - 2]?.x ?? 0;
  };

  for (const item of fan) {
    const arrival = arrivalX("settings", item);
    const aheadOnRow = ids
      .filter((other) => other !== item && positions[other]!.y === positions[item]!.y)
      .filter((other) => positions[other]!.x < positions[item]!.x && other !== "settings");
    for (const other of aheadOnRow) {
      assert.ok(
        arrival > frameOf(other).right,
        `the arrival into ${item} must not start on the edge of ${other}`,
      );
    }
  }
  // A chain the shelf packs is the one case where leaving the card to the left
  // is the truth, and it reads differently for exactly that reason.
  assert.equal(arrivalX("memory", "import"), frameOf("memory").right);
  assert.equal(arrivalX("advanced", "always-ask"), frameOf("advanced").right);
});

test("near-aligned singleton automatic routes stay direct unless a screen blocks them", () => {
  const aligned = { ...settings, id: "aligned", x: 320, y: 13 };
  const direct = canvasEdgeGeometry(
    { from: start.id, to: aligned.id, kind: "forward" },
    [start, aligned],
    (node) => node,
  );

  assert.deepEqual(direct.hitPoints, [
    { x: 240, y: 117 },
    { x: 308, y: 130 },
  ]);
  assert.doesNotMatch(direct.path, / Q | C /);

  const blocker = { ...settings, id: "blocker", x: 320, y: 0 };
  const fartherAligned = { ...settings, id: "farther-aligned", x: 640, y: 13 };
  const detour = canvasEdgeGeometry(
    { from: start.id, to: fartherAligned.id, kind: "forward" },
    [start, blocker, fartherAligned],
    (node) => node,
  );

  assert.match(detour.path, / Q /);
  assert.equal(
    pathEntersFrame(detour.hitPoints, { left: 320, top: 30, right: 560, bottom: 204 }),
    false,
  );
});

test("overlapping automatic frames use an exterior port pair instead of a backwards line", () => {
  const overlap = { ...settings, id: "overlap", x: 220, y: 0 };
  const geometry = canvasEdgeGeometry(
    { from: start.id, to: overlap.id, kind: "forward" },
    [start, overlap],
    (node) => node,
  );

  // The normal right-to-left attachments would lie inside the opposite card.
  // This bounded automatic exception keeps both ends on real frame centres
  // and takes a short exterior U rather than drawing from x=240 back to 208.
  assert.deepEqual(geometry.startPoint, { x: 120, y: 204 });
  assert.deepEqual(geometry.endPoint, { x: 340, y: 216 });
  assert.match(geometry.path, / Q /);
  assert.doesNotMatch(geometry.path, /^M 240 117 L 208 117$/);
  assert.equal(geometry.hitPoints[1]!.y > geometry.startPoint.y, true);
});

test("connector targets stay centred on their chosen edge", () => {
  const geometry = canvasEdgeGeometry(
    {
      from: "start",
      to: "settings",
      kind: "forward",
      presentation: {
        sourcePort: "bottom",
        sourceOffset: 0.25,
        targetPort: "top",
        targetOffset: 0.75,
      },
    },
    [start, settings],
    (node) => node,
  );

  assert.deepEqual(geometry.startPoint, { x: 120, y: 204 });
  // `targetOffset` may exist in older map data, but it is no longer an
  // interaction affordance. The arrow must make its destination unambiguous.
  assert.deepEqual(geometry.endPoint, { x: 440, y: 102 });
});

test("computed fan lanes never move an unrecorded source attachment", () => {
  const geometry = canvasEdgeGeometry(
    {
      from: "start",
      to: "settings",
      kind: "forward",
      presentation: { sourcePort: "right", sourceOffset: 0.2 },
      automaticSourceLane: true,
    },
    [start, settings],
    (node) => node,
  );

  // The lane remains an internal routing hint; a connection with no recorded
  // interaction origin visibly leaves the middle of the right edge.
  assert.deepEqual(geometry.startPoint, { x: 240, y: 117 });
});

test("connector arrowheads stop before the target frame on every side", () => {
  const right = { ...settings, id: "right", x: 640, y: 84 };
  const below = { ...settings, id: "below", x: 0, y: 400 };
  const left = { ...settings, id: "left", x: -320, y: 84 };
  const above = { ...settings, id: "above", x: 0, y: -400 };
  const targets = [
    { node: right, expected: { x: 628, y: 201 } },
    { node: below, expected: { x: 120, y: 418 } },
    { node: left, expected: { x: -68, y: 201 } },
    { node: above, expected: { x: 120, y: -184 } },
  ];

  for (const { node, expected } of targets) {
    const geometry = canvasEdgeGeometry(
      { from: start.id, to: node.id, kind: "forward" },
      [start, node],
      (candidate) => candidate,
    );
    assert.deepEqual(geometry.endPoint, expected);
    assert.equal(canvasEdgeArrowPath(geometry).includes(`${expected.x} ${expected.y}`), true);
  }
});

test("connector routes and arrowheads are world-invariant while canvas zooms", () => {
  const scales = [0.5, 1, 2];
  assert.deepEqual(scales.map(connectorTargetGapForViewport), [12, 12, 12]);

  const curveTarget = { ...settings, id: "zoom-curve-target", x: 640, y: 720 };
  const elbowTarget = { ...settings, id: "zoom-elbow-target", x: 640, y: 420 };
  const cases = [
    {
      target: curveTarget,
      presentation: { route: "curve" as const },
    },
    {
      target: elbowTarget,
      presentation: { route: "elbow" as const },
    },
  ];

  for (const { target, presentation } of cases) {
    const geometries = scales.map((scale) =>
      canvasEdgeGeometry(
        {
          from: start.id,
          to: target.id,
          kind: "forward",
          presentation,
          targetGap: connectorTargetGapForViewport(scale),
        },
        [start, target],
        (node) => node,
      ),
    );
    const baseline = geometries[0]!;
    const geometrySnapshot = (geometry: (typeof geometries)[number]) => ({
      path: geometry.path,
      labelPoint: geometry.labelPoint,
      startPoint: geometry.startPoint,
      endPoint: geometry.endPoint,
      endTangentPoint: geometry.endTangentPoint,
      hitPoints: geometry.hitPoints,
    });
    const baselineArrow = canvasEdgeArrowPath(baseline, 2);

    for (const geometry of geometries.slice(1)) {
      assert.deepEqual(geometrySnapshot(geometry), geometrySnapshot(baseline));
      assert.equal(canvasEdgeArrowPath(geometry, 2), baselineArrow);
    }
  }
});

test("elbow connectors use rounded corners instead of brittle sharp turns", () => {
  const geometry = canvasEdgeGeometry(
    {
      from: "start",
      to: "settings",
      kind: "forward",
      presentation: { route: "elbow" },
    },
    [start, settings],
    (node) => node,
  );

  assert.match(geometry.path, / Q /);
});

test("dragging a curve handle moves its visible midpoint exactly", () => {
  const curveTarget = { ...settings, id: "curve-target", x: 640 };
  const base = canvasEdgeGeometry(
    { from: "start", to: curveTarget.id, kind: "forward", presentation: { route: "curve" } },
    [start, curveTarget],
    (node) => node,
  );
  const adjusted = canvasEdgeGeometry(
    {
      from: "start",
      to: curveTarget.id,
      kind: "forward",
      presentation: { route: "curve", controlOffset: { x: 30, y: -20 } },
    },
    [start, curveTarget],
    (node) => node,
  );

  assert.equal(base.isEditableCurve, true);
  assert.equal(adjusted.isEditableCurve, true);
  assert.deepEqual(adjusted.labelPoint, {
    x: base.labelPoint.x + 30,
    y: base.labelPoint.y - 20,
  });
});

test("free curves preserve both endpoint normals when a midpoint is dragged", () => {
  const curveTarget = { ...settings, id: "normal-target", x: 640, y: 720 };
  const geometryFor = (presentation: {
    route: "curve";
    controlOffset?: { x: number; y: number };
  }) =>
    canvasEdgeGeometry(
      { from: start.id, to: curveTarget.id, kind: "forward", presentation },
      [start, curveTarget],
      (node) => node,
    );

  const untouched = geometryFor({ route: "curve" });
  const untouchedSegments = cubicSegments(untouched.path);
  // Right → left: the untouched cubic starts and ends horizontally, so both
  // screen attachments read as deliberate normal connectors.
  assert.equal(untouchedSegments.length, 1);
  assert.equal(untouchedSegments[0]!.control1.y, untouched.startPoint.y);
  assert.equal(untouchedSegments[0]!.control2.y, untouched.endPoint.y);
  assert.ok(untouchedSegments[0]!.control1.x > untouched.startPoint.x);
  assert.ok(untouchedSegments[0]!.control2.x < untouched.endPoint.x);

  const shaped = geometryFor({ route: "curve", controlOffset: { x: -16, y: 94 } });
  const shapedSegments = cubicSegments(shaped.path);
  // The draggable center is a C² join. It keeps its requested center while
  // the outer handles remain cardinally normal to both screen ports.
  assert.equal(shapedSegments.length, 2);
  assert.equal(shapedSegments[0]!.control1.y, shaped.startPoint.y);
  assert.equal(shapedSegments[1]!.control2.y, shaped.endPoint.y);
  assert.deepEqual(shaped.endTangentPoint, shapedSegments[1]!.control2);
  assert.deepEqual(shaped.labelPoint, {
    x: untouched.labelPoint.x - 16,
    y: untouched.labelPoint.y + 94,
  });
  assert.ok(
    Math.abs(
      shaped.labelPoint.x -
        shapedSegments[0]!.control2.x -
        (shapedSegments[1]!.control1.x - shaped.labelPoint.x),
    ) < 0.000_001,
  );
  assert.ok(
    Math.abs(
      shaped.labelPoint.y -
        shapedSegments[0]!.control2.y -
        (shapedSegments[1]!.control1.y - shaped.labelPoint.y),
    ) < 0.000_001,
  );
});

test("normal cubic solver handles perpendicular turns and separated same-side U routes", () => {
  const perpendicularTargets = [
    { ...settings, id: "perpendicular-close", x: 288, y: 260 },
    { ...settings, id: "perpendicular-far", x: 960, y: 860 },
  ];

  for (const target of perpendicularTargets) {
    const geometry = canvasEdgeGeometry(
      {
        from: start.id,
        to: target.id,
        kind: "forward",
        presentation: { route: "curve", sourcePort: "right", targetPort: "top" },
      },
      [start, target],
      (node) => node,
    );
    const [segment] = cubicSegments(geometry.path);
    assert.equal(geometry.isEditableCurve, true);
    assert.equal(cubicSegments(geometry.path).length, 1);
    assert.equal(segment!.control1.y, geometry.startPoint.y);
    assert.equal(segment!.control2.x, geometry.endPoint.x);
    assert.ok(segment!.control1.x > geometry.startPoint.x);
    assert.ok(segment!.control2.y < geometry.endPoint.y);
    for (let index = 1; index < geometry.hitPoints.length; index += 1) {
      assert.ok(geometry.hitPoints[index]!.x >= geometry.hitPoints[index - 1]!.x);
      assert.ok(geometry.hitPoints[index]!.y >= geometry.hitPoints[index - 1]!.y);
    }
  }

  const sameSideTarget = { ...settings, id: "same-side-separated", x: 460, y: 360 };
  const sameSide = canvasEdgeGeometry(
    {
      from: start.id,
      to: sameSideTarget.id,
      kind: "forward",
      presentation: { route: "curve", sourcePort: "right", targetPort: "right" },
    },
    [start, sameSideTarget],
    (node) => node,
  );
  const [sameSideSegment] = cubicSegments(sameSide.path);
  assert.equal(sameSide.isEditableCurve, true);
  assert.equal(cubicSegments(sameSide.path).length, 1);
  assert.equal(sameSideSegment!.control1.y, sameSide.startPoint.y);
  assert.equal(sameSideSegment!.control2.y, sameSide.endPoint.y);
  assert.ok(sameSideSegment!.control1.x > Math.max(sameSide.startPoint.x, sameSide.endPoint.x));
  assert.ok(sameSideSegment!.control2.x > Math.max(sameSide.startPoint.x, sameSide.endPoint.x));
  assert.ok(sameSide.endTangentPoint!.x > sameSide.endPoint.x);
  assert.equal(sameSide.endTangentPoint!.y, sameSide.endPoint.y);
  for (let index = 1; index < sameSide.hitPoints.length; index += 1) {
    assert.ok(sameSide.hitPoints[index]!.y >= sameSide.hitPoints[index - 1]!.y);
  }
  assert.equal(
    sampledPathEntersFrame(sameSide.hitPoints, { left: 460, top: 390, right: 700, bottom: 564 }),
    false,
  );
});

test("a free curve falls back before it enters an unrelated screen frame", () => {
  const blocker = { ...settings, id: "curve-blocker", x: 480, y: 130 };
  const target = { ...settings, id: "curve-target", x: 640, y: 400 };
  const geometry = canvasEdgeGeometry(
    {
      from: start.id,
      to: target.id,
      kind: "forward",
      presentation: { route: "curve", sourcePort: "right", targetPort: "top" },
    },
    [start, blocker, target],
    (node) => node,
  );

  // The direct normal cubic would sweep the blocker. The router preserves a
  // safe exterior backbone instead, without advertising a nonsensical anchor.
  assert.equal(geometry.isEditableCurve, false);
  assert.match(geometry.path, / C /);
  const blockerFrame = { left: 480, top: 160, right: 720, bottom: 334 };
  assert.equal(sampledPathEntersFrame(geometry.hitPoints, blockerFrame), false);
  assert.equal(pathEntersFrame(geometry.hitPoints, blockerFrame), false);
});

test("analytic curve collision safety catches a narrow frame corner missed by marquee samples", () => {
  const blocker = { ...settings, id: "thin-corner-blocker", x: 957, y: 621 };
  const target = { ...settings, id: "thin-corner-target", x: 860, y: 893 };
  const geometry = canvasEdgeGeometry(
    {
      from: start.id,
      to: target.id,
      kind: "forward",
      presentation: { route: "curve", sourcePort: "bottom", targetPort: "top" },
    },
    [start, blocker, target],
    (node) => node,
  );

  // The direct curve reaches the blocker only in a narrow t interval around
  // .9024; 33 lightweight marquee samples jump over it. Recursive Bézier
  // collision detection must choose the exterior backbone instead.
  assert.equal(geometry.isEditableCurve, false);
  assert.match(geometry.path, / C /);
  assert.equal(
    sampledPathEntersFrame(geometry.hitPoints, {
      left: 957,
      top: 651,
      right: 1197,
      bottom: 825,
    }),
    false,
  );
});

test("explicit facing curves never fold back across their source-to-target axis", () => {
  const farBelow = { ...settings, id: "far-below", x: 640, y: 720 };
  const shaped = canvasEdgeGeometry(
    {
      from: start.id,
      to: farBelow.id,
      kind: "forward",
      presentation: { route: "curve", controlOffset: { x: 1_000, y: -48 } },
    },
    [start, farBelow],
    (node) => node,
  );

  assert.match(shaped.path, / C /);
  for (let index = 1; index < shaped.hitPoints.length; index += 1) {
    assert.ok(shaped.hitPoints[index]!.x >= shaped.hitPoints[index - 1]!.x);
  }
  // A huge forward drag cannot collapse C2 into the endpoint: that would
  // make the otherwise horizontal tangent visually turn at the very end.
  assert.ok(shaped.endPoint.x - shaped.endTangentPoint!.x >= 7.999);
  assert.equal(shaped.endTangentPoint!.y, shaped.endPoint.y);
  // The final tangent remains forward into the target's left edge, so the
  // arrowhead does not point back through the connector.
  assert.ok(shaped.hitPoints.at(-2)!.x < shaped.endPoint.x);

  const shortFacing = { ...settings, id: "short-facing", x: 288, y: 0 };
  const gentleShortCurve = canvasEdgeGeometry(
    {
      from: start.id,
      to: shortFacing.id,
      kind: "forward",
      presentation: { route: "curve" },
    },
    [start, shortFacing],
    (node) => node,
  );

  // A modest 36-world-unit forward span is still a useful editable curve;
  // the pull cap keeps its samples monotonic instead of degrading it to an
  // elbow merely because the cards are close.
  assert.match(gentleShortCurve.path, / C /);
  for (let index = 1; index < gentleShortCurve.hitPoints.length; index += 1) {
    assert.ok(gentleShortCurve.hitPoints[index]!.x >= gentleShortCurve.hitPoints[index - 1]!.x);
  }

  const tooClose = { ...settings, id: "too-close", x: 264, y: 0 };
  const safeFallback = canvasEdgeGeometry(
    {
      from: start.id,
      to: tooClose.id,
      kind: "forward",
      presentation: { route: "curve" },
    },
    [start, tooClose],
    (node) => node,
  );

  // A 12-world-unit forward gap cannot host two safe free-cubic handles. It
  // still honors Curve visually through the exterior cubic backbone, but does
  // not expose a misleading single-curve drag anchor.
  assert.match(safeFallback.path, / C /);
  assert.doesNotMatch(safeFallback.path, / Q /);
  assert.equal(safeFallback.isEditableCurve, false);
});

test("free curves arrive fluidly on the selected target port", () => {
  const target = { ...settings, id: "terminal-target", x: 640, y: 84 };
  const geometry = canvasEdgeGeometry(
    {
      from: start.id,
      to: target.id,
      kind: "forward",
      presentation: { route: "curve" },
    },
    [start, target],
    (node) => node,
  );
  const controls = geometry.path.match(
    /^M [-\d.]+ [-\d.]+ C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+),/,
  );
  assert.ok(controls);

  // One continuous cubic, rather than a visible terminal rail, reaches the
  // port. Its target-side handle stays on the target's horizontal axis, so
  // the derivative at the arrow is exactly horizontal and has a material
  // distance in which to flatten naturally.
  assert.match(geometry.path, / C /);
  assert.doesNotMatch(geometry.path, / C .* C /);
  assert.doesNotMatch(geometry.path, / L /);
  const targetControl = { x: Number(controls[3]), y: Number(controls[4]) };
  assert.equal(targetControl.y, geometry.endPoint.y);
  assert.ok(geometry.endPoint.x - targetControl.x >= 32);
  // The head follows the analytic cubic tangent (C2 → end), not a coarse
  // marquee sample that would still be slightly diagonal near the endpoint.
  assert.equal(
    canvasEdgeArrowPath(geometry, 2),
    `M ${geometry.endPoint.x - 7.75} ${geometry.endPoint.y + 7.75} L ${geometry.endPoint.x} ${geometry.endPoint.y} L ${geometry.endPoint.x - 7.75} ${geometry.endPoint.y - 7.75}`,
  );

  const terminalSamples = geometry.hitPoints.slice(-5);
  for (let index = 1; index < geometry.hitPoints.length; index += 1) {
    assert.ok(geometry.hitPoints[index]!.y >= geometry.hitPoints[index - 1]!.y);
  }
  const terminalRise = terminalSamples
    .slice(1)
    .map((point, index) => point.y - terminalSamples[index]!.y);
  assert.ok(terminalRise[0]! > terminalRise[1]!);
  assert.ok(terminalRise[1]! > terminalRise[2]!);
  assert.ok(terminalRise[2]! > terminalRise[3]!);
  assert.ok(geometry.hitPoints.at(-2)!.x < geometry.endPoint.x);

  const farBelow = { ...settings, id: "shaped-terminal-target", x: 640, y: 720 };
  const shaped = canvasEdgeGeometry(
    {
      from: start.id,
      to: farBelow.id,
      kind: "forward",
      presentation: { route: "curve", controlOffset: { x: -16, y: 94 } },
    },
    [start, farBelow],
    (node) => node,
  );
  const shapedSegments = cubicSegments(shaped.path);
  assert.equal(shapedSegments.length, 2);
  assert.doesNotMatch(shaped.path, / L /);
  assert.equal(shapedSegments[0]!.control1.y, shaped.startPoint.y);
  assert.equal(shaped.endTangentPoint!.y, shaped.endPoint.y);
  assert.deepEqual(shaped.endTangentPoint, shapedSegments[1]!.control2);
  for (let index = 1; index < shaped.hitPoints.length; index += 1) {
    assert.ok(shaped.hitPoints[index]!.y >= shaped.hitPoints[index - 1]!.y);
  }
});

test("a very tall left-side curve uses a generated, steeper exterior arrival", () => {
  const target = { ...settings, id: "very-tall-left-arrival", x: 400, y: 2_000 };
  const edge = {
    from: start.id,
    to: target.id,
    kind: "forward" as const,
  };
  const untouched = canvasEdgeGeometry(
    {
      ...edge,
      presentation: {
        route: "curve",
        sourcePort: "right",
        targetPort: "left",
      },
    },
    [start, target],
    (node) => node,
  );
  const geometry = canvasEdgeGeometry(
    {
      ...edge,
      presentation: {
        route: "curve",
        sourcePort: "right",
        targetPort: "left",
        // This is the same kind of authored centre adjustment that exposed
        // the bad last-moment turn in the live map.
        controlOffset: { x: -16, y: 94 },
      },
    },
    [start, target],
    (node) => node,
  );

  // The narrow horizontal gap cannot contain a useful free midpoint drag.
  // Use one generated exterior spline for both variants rather than expose a
  // misleading anchor which would recreate the terminal hook.
  assert.equal(geometry.isEditableCurve, false);
  assert.equal(untouched.isEditableCurve, false);
  assert.equal(geometry.path, untouched.path);
  assert.equal(cubicSegments(geometry.path).length, 3);
  const segments = geometry.cubicSegments;
  assert.ok(segments);
  assert.equal(segments.length, 3);
  const entry = segments[0]!;
  const trunk = segments[1]!;
  const terminal = segments[2]!;

  // The two joins are C¹, not just visually adjacent segments. The first
  // exits horizontally, the middle is a genuine exterior vertical trunk,
  // and the terminal does all of its horizontal arrival before the arrow.
  assert.deepEqual(
    {
      x: entry.end.x - entry.control2.x,
      y: entry.end.y - entry.control2.y,
    },
    {
      x: trunk.control1.x - trunk.start.x,
      y: trunk.control1.y - trunk.start.y,
    },
  );
  assert.deepEqual(
    {
      x: trunk.end.x - trunk.control2.x,
      y: trunk.end.y - trunk.control2.y,
    },
    {
      x: terminal.control1.x - terminal.start.x,
      y: terminal.control1.y - terminal.start.y,
    },
  );
  assert.equal(entry.control1.y, geometry.startPoint.y);
  assert.equal(trunk.start.x, trunk.end.x);
  assert.ok(trunk.end.y > trunk.start.y);
  assert.ok(trunk.control1.y <= trunk.control2.y);
  assert.equal(terminal.control2.y, geometry.endPoint.y);
  assert.deepEqual(geometry.endTangentPoint, terminal.control2);
  assert.ok(geometry.endPoint.x - terminal.start.x >= 56);
  assert.ok(geometry.endPoint.x - geometry.endTangentPoint!.x >= 30);
  assert.doesNotMatch(geometry.path, / L /);
  assert.doesNotMatch(geometry.path, / Q /);
});

test("recorded origins stay exact when another screen is near the connection", () => {
  const blocker = { ...settings, id: "blocker", x: 320, y: 0 };
  const target = { ...settings, id: "target", x: 640, y: 0 };
  const geometry = canvasEdgeGeometry(
    {
      from: "start",
      to: "target",
      kind: "forward",
      sourceAnchor: { point: { x: 0.75, y: 0.7 } },
    },
    [start, blocker, target],
    (node) => node,
  );

  assert.deepEqual(geometry.startPoint, { x: 180, y: 151.8 });
  assert.match(geometry.path, /^M 180 151\.8 L /);
  assert.match(geometry.path, / Q /);
});

test("unobstructed branches use a rounded bent corridor across rows", () => {
  const target = { ...settings, id: "target", x: 640, y: 400 };
  const geometry = canvasEdgeGeometry(
    { from: "start", to: "target", kind: "forward" },
    [start, target],
    (node) => node,
  );

  assert.deepEqual(geometry.startPoint, { x: 240, y: 117 });
  assert.match(geometry.path, /^M 240 117 L /);
  assert.match(geometry.path, / Q /);
  assert.match(geometry.path, / L 628 517$/);
});

test("recorded tap origins stay exact on vertical connections", () => {
  const below = { ...settings, id: "below", x: 0, y: 400 };
  const geometry = canvasEdgeGeometry(
    {
      from: "start",
      to: "below",
      kind: "forward",
      sourceAnchor: { point: { x: 0.25, y: 0.7 } },
    },
    [start, below],
    (node) => node,
  );

  assert.deepEqual(geometry.startPoint, { x: 60, y: 151.8 });
  assert.match(geometry.path, /^M 60 151\.8 L 60 /);
});

test("recorded connection origins follow rotated screenshot presentation", () => {
  assert.deepEqual(pointInDisplayedFrame({ x: 0.25, y: 0.7 }, "left"), {
    x: 0.7,
    y: 0.75,
  });
  const path = canvasEdgeGeometry(
    {
      from: "start",
      to: "settings",
      kind: "forward",
      sourceAnchor: { point: { x: 0.25, y: 0.7 } },
      sourceRotation: "left",
    },
    [start, settings],
    (node) => node,
  ).path;
  assert.match(path, /^M 168 160\.5 L/);
});

test("return connections also leave from the recorded interaction point", () => {
  const geometry = canvasEdgeGeometry(
    {
      from: "settings",
      to: "start",
      kind: "return",
      sourceAnchor: { point: { x: 0.25, y: 0.7 } },
    },
    [start, settings],
    (node) => node,
  );

  assert.deepEqual(geometry.startPoint, { x: 380, y: 235.8 });
  assert.match(geometry.path, /^M 380 235\.8 L/);
});

test("explicit connector offsets retain direct predictable bend lanes", () => {
  const target = { ...settings, id: "target", x: 640, y: 300 };
  const lanes = [0.2, 0.5, 0.8].map((offset) =>
    canvasEdgeGeometry(
      {
        from: "start",
        to: "target",
        kind: "forward",
        presentation: { sourceOffset: offset, targetOffset: offset },
      },
      [start, target],
      (node) => node,
    ),
  );
  const railX = lanes.map((geometry) => {
    const segment = geometry.hitPoints.find(
      (point, index) =>
        index > 0 &&
        point.x === geometry.hitPoints[index - 1]!.x &&
        point.y !== geometry.hitPoints[index - 1]!.y,
    );
    return segment?.x;
  });

  assert.deepEqual(
    railX,
    [...railX].sort((left, right) => left! - right!),
  );
  assert.equal(new Set(railX).size, 3);
});

test("automatic recorded source fans use nested trunks instead of crossing their siblings", () => {
  const top = { ...settings, id: "top", x: 640, y: 0 };
  const middle = { ...settings, id: "middle", x: 640, y: 360 };
  const bottom = { ...settings, id: "bottom", x: 640, y: 720 };
  const nodes = [start, top, middle, bottom];
  const edges = [
    { to: top.id, anchorY: 0.2, lane: 0.2 },
    { to: middle.id, anchorY: 0.5, lane: 0.5 },
    { to: bottom.id, anchorY: 0.8, lane: 0.8 },
  ].map(({ to, anchorY, lane }) =>
    canvasEdgeGeometry(
      {
        from: start.id,
        to,
        kind: "forward",
        sourceAnchor: { point: { x: 0.5, y: anchorY } },
        presentation: { sourceOffset: lane },
        automaticSourceLane: true,
      },
      nodes,
      (node) => node,
    ),
  );

  assert.equal(pathsHaveProperCrossing(edges[0]!.hitPoints, edges[1]!.hitPoints), false);
  assert.equal(pathsHaveProperCrossing(edges[0]!.hitPoints, edges[2]!.hitPoints), false);
  assert.equal(pathsHaveProperCrossing(edges[1]!.hitPoints, edges[2]!.hitPoints), false);
  const verticalRailXs = edges.map(
    (edge) =>
      edge.hitPoints.find(
        (point, index) =>
          index > 2 &&
          point.x === edge.hitPoints[index - 1]!.x &&
          point.y !== edge.hitPoints[index - 1]!.y,
      )?.x,
  );
  assert.deepEqual(
    verticalRailXs,
    [...verticalRailXs].sort((left, right) => right! - left!),
  );
});

test("automatic label-only source fans use nested trunks without proper crossings", () => {
  const top = { ...settings, id: "top", x: 640, y: 0 };
  const middle = { ...settings, id: "middle", x: 640, y: 360 };
  const bottom = { ...settings, id: "bottom", x: 640, y: 720 };
  const nodes = [start, top, middle, bottom];
  const connections = [
    {
      id: "bottom-action",
      fromScreenId: start.id,
      toScreenId: bottom.id,
    },
    {
      id: "top-action",
      fromScreenId: start.id,
      toScreenId: top.id,
    },
    {
      id: "middle-action",
      fromScreenId: start.id,
      toScreenId: middle.id,
    },
  ];
  const nodeForId = new Map(nodes.map((node) => [node.id, node]));
  const lanes = connectorAutoLanes(connections, (screenId) => nodeForId.get(screenId));
  const geometryFor = (connection: (typeof connections)[number]) =>
    canvasEdgeGeometry(
      {
        from: connection.fromScreenId,
        to: connection.toScreenId,
        kind: "forward",
        presentation: connectorPresentationWithAutoLane(connection, lanes),
        automaticSourceLane: connectorHasAutomaticSourceLane(connection, lanes),
      },
      nodes,
      (node) => node,
    );

  const topAction = geometryFor(connections[1]!);
  const middleAction = geometryFor(connections[2]!);
  const bottomAction = geometryFor(connections[0]!);

  assert.equal(connectorHasAutomaticSourceLane(connections[1]!, lanes), true);
  assert.equal(connectorHasAutomaticSourceLane(connections[2]!, lanes), true);
  assert.equal(connectorHasAutomaticSourceLane(connections[0]!, lanes), true);
  assert.equal(lanes.get("top-action")?.sourceOffset, 0.2);
  assert.equal(lanes.get("middle-action")?.sourceOffset, 0.5);
  assert.equal(lanes.get("bottom-action")?.sourceOffset, 0.8);
  assert.equal(pathsHaveProperCrossing(topAction.hitPoints, middleAction.hitPoints), false);
  assert.equal(pathsHaveProperCrossing(topAction.hitPoints, bottomAction.hitPoints), false);
  assert.equal(pathsHaveProperCrossing(middleAction.hitPoints, bottomAction.hitPoints), false);
});

test("a close unanchored branch keeps later source fan rails inside it", () => {
  // The near card leaves barely one normal route stub between its left edge
  // and the source. A per-edge midpoint would make the middle branch cross
  // its vertical rail; the fan router instead reserves progressively inner
  // turns from the common source edge.
  const near = { ...settings, id: "near", x: 352, y: 10 };
  const middle = { ...settings, id: "middle", x: 528, y: 360 };
  const lower = { ...settings, id: "lower", x: 376, y: 720 };
  const nodes = [start, near, middle, lower];
  const connections = [
    { id: "lower", fromScreenId: start.id, toScreenId: lower.id },
    { id: "near", fromScreenId: start.id, toScreenId: near.id },
    { id: "middle", fromScreenId: start.id, toScreenId: middle.id },
  ];
  const nodeForId = new Map(nodes.map((node) => [node.id, node]));
  const lanes = connectorAutoLanes(connections, (screenId) => nodeForId.get(screenId));
  const geometryFor = (connection: (typeof connections)[number]) =>
    canvasEdgeGeometry(
      {
        from: connection.fromScreenId,
        to: connection.toScreenId,
        kind: "forward",
        presentation: connectorPresentationWithAutoLane(connection, lanes),
        automaticSourceLane: connectorHasAutomaticSourceLane(connection, lanes),
      },
      nodes,
      (node) => node,
    );

  const nearEdge = geometryFor(connections[1]!);
  const middleEdge = geometryFor(connections[2]!);
  const lowerEdge = geometryFor(connections[0]!);

  assert.equal(pathsHaveProperCrossing(nearEdge.hitPoints, middleEdge.hitPoints), false);
  assert.equal(pathsHaveProperCrossing(nearEdge.hitPoints, lowerEdge.hitPoints), false);
  assert.equal(pathsHaveProperCrossing(middleEdge.hitPoints, lowerEdge.hitPoints), false);
});

test("an unanchored curved fan link follows the safe backbone until it is shaped", () => {
  const top = { ...settings, id: "top", x: 640, y: 0 };
  const curveTarget = { ...settings, id: "curve-target", x: 640, y: 420 };
  const bottom = { ...settings, id: "bottom", x: 640, y: 840 };
  const nodes = [start, top, curveTarget, bottom];
  const connections = [
    { id: "bottom", fromScreenId: start.id, toScreenId: bottom.id },
    {
      id: "curve",
      fromScreenId: start.id,
      toScreenId: curveTarget.id,
      presentation: { route: "curve" as const },
    },
    { id: "top", fromScreenId: start.id, toScreenId: top.id },
  ];
  const nodeForId = new Map(nodes.map((node) => [node.id, node]));
  const lanes = connectorAutoLanes(connections, (screenId) => nodeForId.get(screenId));
  const geometryFor = (
    connection: (typeof connections)[number],
    presentation = connectorPresentationWithAutoLane(connection, lanes),
  ) =>
    canvasEdgeGeometry(
      {
        from: connection.fromScreenId,
        to: connection.toScreenId,
        kind: "forward",
        presentation,
        automaticSourceLane: connectorHasAutomaticSourceLane(connection, lanes),
      },
      nodes,
      (node) => node,
    );

  const topEdge = geometryFor(connections[2]!);
  const curveEdge = geometryFor(connections[1]!);
  const bottomEdge = geometryFor(connections[0]!);

  // Curve is an explicit choice even before an anchor moves. Its automatic
  // fan form is a compound C path over the reserved safe backbone, not an
  // unchanged Bent/Q route or a giant free diagonal through siblings.
  assert.equal(connectorHasAutomaticSourceLane(connections[1]!, lanes), true);
  assert.match(curveEdge.path, / C /);
  assert.doesNotMatch(curveEdge.path, / Q /);
  assert.equal(pathsHaveProperCrossing(topEdge.hitPoints, curveEdge.hitPoints), false);
  assert.equal(pathsHaveProperCrossing(curveEdge.hitPoints, bottomEdge.hitPoints), false);

  const bent = geometryFor(connections[1]!, {
    ...connectorPresentationWithAutoLane(connections[1]!, lanes),
    route: "elbow",
  });
  assert.match(bent.path, / Q /);
  assert.doesNotMatch(bent.path, / C /);

  // A near-zero control movement can be left behind by pointer jitter while
  // creating a curve. It keeps the same no-crossing cubic backbone rather
  // than silently switching the selected Curved route back to Bent.
  const jitter = geometryFor(connections[1]!, {
    ...connectorPresentationWithAutoLane(connections[1]!, lanes),
    controlOffset: { x: 3.93, y: 1.78 },
  });
  assert.match(jitter.path, / C /);
  assert.doesNotMatch(jitter.path, / Q /);
  assert.equal(pathsHaveProperCrossing(topEdge.hitPoints, jitter.hitPoints), false);
  assert.equal(pathsHaveProperCrossing(jitter.hitPoints, bottomEdge.hitPoints), false);

  // Dragging the visible curve anchor remains an intentional free cubic.
  const shaped = geometryFor(connections[1]!, {
    ...connectorPresentationWithAutoLane(connections[1]!, lanes),
    controlOffset: { x: 36, y: -24 },
  });
  assert.match(shaped.path, / C /);
});

test("non-viable Curve paths use an exterior cubic backbone without a fake drag anchor", () => {
  const target = { ...settings, id: "target", x: 460, y: 0 };
  const elbow = canvasEdgeGeometry(
    {
      from: "start",
      to: "target",
      kind: "forward",
      presentation: { sourcePort: "right", targetPort: "right" },
    },
    [start, target],
    (node) => node,
  );
  const curve = canvasEdgeGeometry(
    {
      from: "start",
      to: "target",
      kind: "forward",
      presentation: { route: "curve", sourcePort: "right", targetPort: "top" },
    },
    [start, target],
    (node) => node,
  );

  assert.equal(
    pathEntersFrame(elbow.hitPoints, { left: 460, top: 30, right: 700, bottom: 204 }),
    false,
  );
  assert.ok(elbow.hitPoints.at(-2)!.x > elbow.endPoint.x);
  assert.match(elbow.path, / Q /);
  assert.equal(elbow.isEditableCurve, false);

  // Adjacent ports cannot form one monotonic free cubic. Curve remains
  // visibly curved through the collision-safe cubic backbone, but reports no
  // editable handle because a drag would not have one coherent control point.
  assert.match(curve.path, / C /);
  assert.doesNotMatch(curve.path, / Q /);
  assert.equal(curve.isEditableCurve, false);
  assert.ok(curve.hitPoints.at(-2)!.y < curve.endPoint.y);

  const sameSideCurve = canvasEdgeGeometry(
    {
      from: "start",
      to: "target",
      kind: "forward",
      presentation: { route: "curve", sourcePort: "right", targetPort: "right" },
    },
    [start, target],
    (node) => node,
  );
  assert.match(sameSideCurve.path, / C /);
  assert.doesNotMatch(sameSideCurve.path, / Q /);
  assert.equal(sameSideCurve.isEditableCurve, false);
  assert.equal(
    pathEntersFrame(sameSideCurve.hitPoints, { left: 460, top: 30, right: 700, bottom: 204 }),
    false,
  );
});

test("fit keeps a graph visible with stable canvas padding", () => {
  const view = fitCanvasViewport({ width: 800, height: 600 }, { width: 1200, height: 800 });
  assert.ok(view.scale > 0 && view.scale <= 1);
  assert.ok(view.x >= 0);
  assert.ok(view.y >= 0);
});

test("Fit can show a complete tall map below the interactive zoom floor", () => {
  const view = fitCanvasViewport({ width: 1400, height: 800 }, { width: 2200, height: 14_000 });
  assert.ok(view.scale < MIN_CANVAS_SCALE);
  assert.ok(view.scale > 0);
});

test("interactive canvas zoom tops out at 200 percent", () => {
  assert.equal(MAX_CANVAS_SCALE, 2);
  assert.equal(clampCanvasScale(2.4), 2);
});

test("fit includes content positioned left and above the world origin", () => {
  const negative = { ...start, x: -420, y: -180 };
  const bounds = canvasBounds([negative, settings], [], (node) => node);
  assert.equal(bounds.left, -420);
  assert.equal(bounds.top, -180);
  const view = fitCanvasViewport({ width: 1000, height: 720 }, bounds);
  assert.ok(negative.x * view.scale + view.x >= 0);
  assert.ok(negative.y * view.scale + view.y >= 0);
});

test("canvas bounds include Combine objects beside the screen graph", () => {
  const bounds = canvasBounds([start], [], (node) => node, [
    { x: 720, y: 80, width: 284, height: 150 },
  ]);
  assert.ok(bounds.right >= 1004);
  assert.ok(bounds.width >= 1004);
});

test("opening a tall map keeps screen labels readable while Fit remains exact", () => {
  const content = { left: 0, top: -630, width: 1104, height: 1576 };
  const fitted = fitCanvasViewport({ width: 1440, height: 716 }, content);
  const opened = openCanvasViewport({ width: 1440, height: 716 }, content);
  assert.ok(fitted.scale < 0.55);
  assert.equal(opened.scale, 0.55);
  assert.equal(opened.x, (1440 - content.width * opened.scale) / 2);
  assert.equal(opened.y + content.top * opened.scale, 56);
});

test("opening a large hub starts at its first section instead of its empty midpoint", () => {
  const content = { left: 0, top: 0, width: 2_000, height: 8_230 };
  const opened = openCanvasViewport({ width: 1440, height: 716 }, content);

  assert.equal(opened.scale, 0.55);
  assert.equal(opened.x, (1440 - content.width * opened.scale) / 2);
  assert.equal(opened.y, 56);
  assert.ok(
    content.height * opened.scale > 4_000,
    "the test must exercise a map whose midpoint would hide the first section",
  );
});

test("keyboard-created branches occupy the nearest open sibling row", () => {
  const source = { x: 0, y: 0 };
  const branchX = 376;
  const branchY = 278;
  assert.deepEqual(nextBranchPosition(source, [source]), { x: branchX, y: 0 });
  assert.deepEqual(nextBranchPosition(source, [source, { x: branchX, y: 0 }]), {
    x: branchX,
    y: branchY,
  });
  assert.deepEqual(
    nextBranchPosition(source, [source, { x: branchX, y: 0 }, { x: branchX, y: branchY }]),
    { x: branchX, y: -branchY },
  );
});
