import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_MEDIA_RATIO,
  boundedMediaRatio,
  dominantMediaRatio,
  mediaAspectStyle,
} from "./app-map-screen-media-aspect";

const PHONE = { width: 1179, height: 2556 };
const TABLET = { width: 1640, height: 2360 };

test("an unmeasured viewport has no ratio", () => {
  assert.equal(boundedMediaRatio(undefined), undefined);
  assert.equal(boundedMediaRatio({ width: 0, height: 100 }), undefined);
  assert.equal(boundedMediaRatio({ width: 100, height: 0 }), undefined);
});

test("a phone keeps its own portrait silhouette", () => {
  const ratio = boundedMediaRatio(PHONE)!;
  assert.ok(ratio > 0.45 && ratio < 0.47, `expected a tall phone ratio, got ${ratio}`);
});

test("a freak viewport is clamped rather than allowed to destabilize the grid", () => {
  assert.equal(boundedMediaRatio({ width: 10, height: 4000 }), 0.46);
  assert.equal(boundedMediaRatio({ width: 4000, height: 10 }), 2);
});

test("an empty grid falls back to a portrait frame", () => {
  assert.equal(dominantMediaRatio([]), FALLBACK_MEDIA_RATIO);
  assert.equal(dominantMediaRatio([undefined, undefined]), FALLBACK_MEDIA_RATIO);
});

test("the grid takes the silhouette most of its screens have", () => {
  const ratio = dominantMediaRatio([PHONE, PHONE, PHONE, TABLET]);
  assert.equal(ratio, dominantMediaRatio([PHONE]));
  assert.notEqual(ratio, dominantMediaRatio([TABLET]));
});

test("captures of one phone that differ by a pixel still count as one device", () => {
  const ratio = dominantMediaRatio([
    PHONE,
    { width: PHONE.width, height: PHONE.height - 1 },
    { width: PHONE.width, height: PHONE.height + 2 },
  ]);
  // All three bucket together, so the grid gets that phone's ratio and not a
  // third value none of them has.
  assert.ok(Math.abs(ratio - boundedMediaRatio(PHONE)!) < 0.02);
});

test("the style value stays short and stable", () => {
  assert.equal(mediaAspectStyle(0.4614589), "0.461");
  assert.equal(mediaAspectStyle(0.5), "0.5");
});
