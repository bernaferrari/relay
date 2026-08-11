import assert from "node:assert/strict";
import test from "node:test";
import { groupBundleGeometry, groupBundleSpokePath } from "./app-map-group-routing";

test("horizontal groups share one right-to-left trunk", () => {
  const route = groupBundleGeometry(
    { left: 0, top: 0, right: 300, bottom: 600 },
    { left: 500, top: 100, right: 800, bottom: 500 },
  );
  assert.equal(route.axis, "horizontal");
  assert.equal(route.sourcePort.x, 300);
  assert.equal(route.targetPort.x, 500);
  assert.match(route.trunkPath, /^M 300 /);
});

test("stacked groups use bottom and top ports with compact spokes", () => {
  const route = groupBundleGeometry(
    { left: 100, top: 0, right: 400, bottom: 300 },
    { left: 0, top: 500, right: 500, bottom: 900 },
  );
  assert.equal(route.axis, "vertical");
  assert.equal(route.sourcePort.y, 300);
  assert.equal(route.targetPort.y, 500);
  assert.match(
    groupBundleSpokePath({ x: 220, y: 180 }, route.sourcePort, route.axis),
    /^M 220 180/,
  );
});
