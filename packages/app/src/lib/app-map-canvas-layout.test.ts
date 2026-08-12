import assert from "node:assert/strict";
import test from "node:test";
import type { MapTreeNode } from "./app-map-tree";
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
  SCREEN_FRAME_MIN_WIDTH,
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
  assert.ok(Math.abs((20 - diagonal![0]!) - (20 - diagonal![5]!)) < 0.0001);
});

test("screen previews preserve phone and tablet viewport silhouettes", () => {
  const phone = screenCardGeometry({ logicalViewport: { width: 1080, height: 2340 } });
  const tablet = screenCardGeometry({ logicalViewport: { width: 1112, height: 834 } });

  assert.ok(phone.frameHeight > phone.frameWidth);
  assert.equal(phone.frameWidth, SCREEN_FRAME_MIN_WIDTH);
  assert.ok(phone.mediaWidth < phone.frameWidth);
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

  assert.ok(media.left > phoneGeometry().frameLeft);
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

  assert.deepEqual(geometry.startPoint, { x: 60, y: 204 });
  // `targetOffset` may exist in older map data, but it is no longer an
  // interaction affordance. The arrow must make its destination unambiguous.
  assert.deepEqual(geometry.endPoint, { x: 440, y: 102 });
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

test("terminal arrow clearance stays visibly constant while zooming", () => {
  assert.equal(connectorTargetGapForViewport(0.5), 16);
  assert.equal(connectorTargetGapForViewport(1), 8);
  assert.equal(connectorTargetGapForViewport(2), 4);

  const target = { ...settings, id: "target", x: 640, y: 84 };
  const geometry = canvasEdgeGeometry(
    {
      from: start.id,
      to: target.id,
      kind: "forward",
      targetGap: connectorTargetGapForViewport(0.5),
    },
    [start, target],
    (node) => node,
  );

  assert.deepEqual(geometry.endPoint, { x: 624, y: 201 });
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

  assert.deepEqual(adjusted.labelPoint, {
    x: base.labelPoint.x + 30,
    y: base.labelPoint.y - 20,
  });
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

  // A 12-world-unit forward gap cannot host two safe cubic handles. It takes
  // the normal obstacle-safe backbone rather than reversing into an S-loop.
  assert.doesNotMatch(safeFallback.path, / C /);
});

test("free curves visibly straighten into the selected target port", () => {
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
  const leadStart = geometry.hitPoints.at(-2)!;
  const beforeLead = geometry.hitPoints.at(-3)!;

  assert.match(geometry.path, / C .* L 628 201$/);
  // The last 32 world units are a real horizontal arrival run into the
  // target's left port—not merely a mathematically horizontal tangent at the
  // final infinitesimal Bézier sample.
  assert.equal(geometry.endPoint.x - leadStart.x, 32);
  assert.equal(geometry.endPoint.y, leadStart.y);
  assert.ok(leadStart.x > beforeLead.x);
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

test("same-side endpoints take an exterior bent route and curves respect the target tangent", () => {
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
  assert.ok(curve.hitPoints.at(-2)!.y < curve.endPoint.y);
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

test("canvas bounds include run-matrix objects beside the screen graph", () => {
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
  assert.ok(Number.isFinite(opened.x));
  assert.ok(Number.isFinite(opened.y));
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
