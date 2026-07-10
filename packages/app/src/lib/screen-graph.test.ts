import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  layoutScreenGraph,
  buildEdges,
  graphBounds,
  fitViewport,
  staggerY,
  staggerX,
  wrapIndex,
  defaultNodePosition,
  pickEdgePorts,
  edgePath,
  edgeKindFor,
  estimateLabelWidth,
  cardSize,
  branchLaneY,
  SCREEN_CARD_W,
  SCREEN_CARD_H,
  SCREEN_PAD,
  SCREEN_WRAP_COLS,
  BRANCH_FAIL_Y,
  BRANCH_HEAL_Y,
  SCREEN_ASPECT,
  type ScreenNode,
  type ScreenStatus,
} from "./screen-graph";

const base = (n: number, status: ScreenStatus = "idle") =>
  Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    index: i,
    caption: `Step ${i + 1}`,
    src: "",
    status,
  }));

function withStatuses(statuses: ScreenStatus[]) {
  return statuses.map((status, i) => ({
    id: `f${i}`,
    index: i,
    caption: `Step ${i + 1}`,
    src: "",
    status,
  }));
}

describe("wrapIndex", () => {
  it("wraps every SCREEN_WRAP_COLS into a new row", () => {
    assert.deepEqual(wrapIndex(0), { row: 0, col: 0 });
    assert.deepEqual(wrapIndex(SCREEN_WRAP_COLS - 1), {
      row: 0,
      col: SCREEN_WRAP_COLS - 1,
    });
    assert.deepEqual(wrapIndex(SCREEN_WRAP_COLS), { row: 1, col: 0 });
    assert.deepEqual(wrapIndex(SCREEN_WRAP_COLS + 2), { row: 1, col: 2 });
  });

  it("respects custom column count", () => {
    assert.deepEqual(wrapIndex(6, 3), { row: 2, col: 0 });
  });
});

describe("staggerY / staggerX / branchLaneY", () => {
  it("returns finite organic offsets", () => {
    for (let i = 0; i < 12; i++) {
      assert.equal(typeof staggerY(i), "number");
      assert.equal(typeof staggerX(i), "number");
      assert.ok(Number.isFinite(staggerY(i)));
      assert.ok(Number.isFinite(staggerX(i)));
    }
  });

  it("places fail below heal below main", () => {
    assert.equal(branchLaneY("idle"), 0);
    assert.equal(branchLaneY("pass"), 0);
    assert.equal(branchLaneY("heal"), BRANCH_HEAL_Y);
    assert.equal(branchLaneY("fail"), BRANCH_FAIL_Y);
    assert.ok(BRANCH_FAIL_Y > BRANCH_HEAL_Y);
  });
});

describe("cardSize", () => {
  it("defaults to phone aspect", () => {
    const s = cardSize();
    assert.equal(s.w, SCREEN_CARD_W);
    assert.equal(s.h, SCREEN_CARD_H);
    assert.ok(Math.abs(s.w / s.h - SCREEN_ASPECT) < 0.02);
  });

  it("respects landscape aspect", () => {
    const s = cardSize({ aspect: 16 / 9 });
    assert.equal(s.w, SCREEN_CARD_W);
    assert.ok(s.h < s.w);
    assert.ok(s.h < SCREEN_CARD_H);
  });

  it("respects explicit height", () => {
    const s = cardSize({ height: 400 });
    assert.equal(s.h, 400);
  });
});

describe("defaultNodePosition / layoutScreenGraph", () => {
  it("places nodes left to right with stagger on first row", () => {
    const nodes = layoutScreenGraph(base(3));
    assert.equal(nodes.length, 3);
    assert.ok(nodes[1]!.x > nodes[0]!.x);
    assert.ok(nodes[2]!.x > nodes[1]!.x);
    const p0 = defaultNodePosition(0);
    // layout may differ slightly due to row max-h packing but first row col0 is same formula
    assert.equal(nodes[0]!.x, p0.x);
    assert.ok(nodes[0]!.w > 0 && nodes[0]!.h > 0);
  });

  it("starts a new row after wrap columns", () => {
    const nodes = layoutScreenGraph(base(SCREEN_WRAP_COLS + 1));
    const first = nodes[0]!;
    const lastFirstRow = nodes[SCREEN_WRAP_COLS - 1]!;
    const firstSecondRow = nodes[SCREEN_WRAP_COLS]!;
    assert.ok(lastFirstRow.x > first.x);
    assert.ok(firstSecondRow.y > first.y + first.h * 0.5);
    assert.ok(firstSecondRow.x < lastFirstRow.x);
  });

  it("applies brick offset on odd rows", () => {
    const a = defaultNodePosition(0);
    const b = defaultNodePosition(SCREEN_WRAP_COLS);
    assert.ok(b.x > a.x - 40);
    assert.ok(b.y - a.y > SCREEN_CARD_H);
  });

  it("honors position overrides", () => {
    const overrides = new Map([["f1", { x: 10, y: 20 }]]);
    const nodes = layoutScreenGraph(base(3), overrides);
    assert.equal(nodes[1]!.x, 10);
    assert.equal(nodes[1]!.y, 20);
  });

  it("drops fail nodes into a lower branch lane", () => {
    const nodes = layoutScreenGraph(withStatuses(["pass", "fail", "heal", "pass"]));
    assert.ok(nodes[1]!.y > nodes[0]!.y + 40, "fail below pass");
    assert.ok(nodes[2]!.y > nodes[0]!.y, "heal mid");
    assert.ok(nodes[2]!.y < nodes[1]!.y, "heal above fail");
    // recovery pass returns near main lane
    assert.ok(Math.abs(nodes[3]!.y - nodes[0]!.y) < 80);
  });

  it("applies aspect overrides to card height", () => {
    const aspects = new Map([["f0", 16 / 9]]);
    const nodes = layoutScreenGraph(base(2), undefined, SCREEN_WRAP_COLS, aspects);
    assert.ok(nodes[0]!.h < nodes[1]!.h);
    assert.ok(nodes[0]!.h < SCREEN_CARD_H);
  });
});

describe("buildEdges / pickEdgePorts / edgePath / edgeKindFor", () => {
  it("connects sequential nodes with paths", () => {
    const nodes = layoutScreenGraph(base(3));
    const edges = buildEdges(nodes);
    assert.equal(edges.length, 2);
    assert.match(edges[0]!.path, /^M /);
    assert.equal(edges[0]!.from, "f0");
    assert.equal(edges[0]!.to, "f1");
    assert.equal(edges[0]!.kind, "flow");
  });

  it("uses side ports for horizontal neighbors", () => {
    const nodes = layoutScreenGraph(base(2));
    const ports = pickEdgePorts(nodes[0]!, nodes[1]!);
    assert.ok(ports.start.x >= nodes[0]!.x + nodes[0]!.w - 1);
    assert.ok(ports.end.x <= nodes[1]!.x + 1);
  });

  it("uses vertical ports across wrapped rows", () => {
    const nodes = layoutScreenGraph(base(SCREEN_WRAP_COLS + 1));
    const a = nodes[SCREEN_WRAP_COLS - 1]!;
    const b = nodes[SCREEN_WRAP_COLS]!;
    const { path, midX, midY } = edgePath(a, b);
    assert.match(path, /^M /);
    assert.ok(Number.isFinite(midX) && Number.isFinite(midY));
    const ports = pickEdgePorts(a, b);
    assert.ok(ports.start.x >= a.x - 1 && ports.start.x <= a.x + a.w + 1);
    assert.ok(ports.end.x >= b.x - 1 && ports.end.x <= b.x + b.w + 1);
  });

  it("routes edges after freeform drag reorder", () => {
    const overrides = new Map([
      ["f0", { x: 400, y: 100 }],
      ["f1", { x: 100, y: 100 }],
    ]);
    const nodes = layoutScreenGraph(base(2), overrides);
    const ports = pickEdgePorts(nodes[0]!, nodes[1]!);
    assert.ok(ports.start.x <= nodes[0]!.x + 1);
    assert.ok(ports.end.x >= nodes[1]!.x + nodes[1]!.w - 1);
    const edges = buildEdges(nodes);
    assert.equal(edges.length, 1);
    assert.match(edges[0]!.path, /C /);
  });

  it("tags fail and heal edge kinds", () => {
    const nodes = layoutScreenGraph(withStatuses(["pass", "fail", "heal", "pass"]));
    const edges = buildEdges(nodes);
    assert.equal(edges[0]!.kind, "fail");
    assert.equal(edges[0]!.label, "fail");
    assert.equal(edges[1]!.kind, "heal");
    assert.equal(edges[2]!.kind, "heal"); // heal → pass recovery
  });

  it("edgeKindFor covers recovery from fail to pass", () => {
    const mk = (status: ScreenStatus, id: string): ScreenNode => ({
      id,
      index: 0,
      x: 0,
      y: 0,
      w: 200,
      h: 400,
      caption: id,
      src: "",
      status,
    });
    assert.equal(edgeKindFor(mk("pass", "a"), mk("fail", "b")), "fail");
    assert.equal(edgeKindFor(mk("fail", "a"), mk("pass", "b")), "heal");
    assert.equal(edgeKindFor(mk("pass", "a"), mk("heal", "b")), "heal");
    assert.equal(edgeKindFor(mk("pass", "a"), mk("pass", "b")), "flow");
  });
});

describe("estimateLabelWidth", () => {
  it("grows with label length and clamps", () => {
    assert.equal(estimateLabelWidth(""), 0);
    assert.ok(estimateLabelWidth("ab") >= 28);
    assert.ok(estimateLabelWidth("hello world") > estimateLabelWidth("hi"));
    assert.ok(estimateLabelWidth("x".repeat(80)) <= 148);
  });
});

describe("graphBounds / fitViewport", () => {
  it("expands bounds past card corners", () => {
    const nodes = layoutScreenGraph(base(2));
    const b = graphBounds(nodes);
    assert.ok(b.width > SCREEN_CARD_W);
    assert.ok(b.height > 0);
    assert.ok(b.minX <= nodes[0]!.x - SCREEN_PAD + 1);
  });

  it("includes wrapped rows in height", () => {
    const single = graphBounds(layoutScreenGraph(base(2)));
    const multi = graphBounds(layoutScreenGraph(base(SCREEN_WRAP_COLS + 2)));
    assert.ok(multi.height > single.height);
  });

  it("includes fail branch in height", () => {
    const linear = graphBounds(layoutScreenGraph(base(3, "pass")));
    const branched = graphBounds(layoutScreenGraph(withStatuses(["pass", "fail", "pass"])));
    assert.ok(branched.height > linear.height);
  });

  it("fits scale into viewport", () => {
    const nodes = layoutScreenGraph(base(4));
    const b = graphBounds(nodes);
    const v = fitViewport(b, 800, 600);
    assert.ok(v.scale > 0 && v.scale <= 1.2);
  });
});
