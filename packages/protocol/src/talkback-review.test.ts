import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewAndroidTalkBack,
  talkBackAnnouncement,
  talkBackSpokenName,
} from "./talkback-review.js";

test("iOS VoiceOver labels become spoken names", () => {
  const review = reviewAndroidTalkBack([
    {
      label: "Preferred Language",
      type: "Cell",
      hittable: true,
      rect: { x: 0, y: 120, width: 390, height: 48 },
      index: 0,
    },
  ]);
  assert.equal(review.items[0]?.name, "Preferred Language");
  assert.match(review.items[0]!.announcement, /Preferred Language/);
});

test("TalkBack prefers content-desc over visible text", () => {
  assert.equal(
    talkBackSpokenName({
      description: "Close",
      label: "Close",
      value: "X",
    }),
    "Close",
  );
  assert.equal(
    talkBackAnnouncement({
      description: "Close",
      value: "X",
      role: "android.widget.ImageButton",
    }),
    "Close, Button",
  );
});

test("a clickable icon without a name is an error", () => {
  const review = reviewAndroidTalkBack([
    {
      role: "android.widget.ImageButton",
      hittable: true,
      identifier: "app:id/overflow",
      rect: { x: 10, y: 10, width: 48, height: 48 },
      index: 0,
    },
  ]);
  assert.equal(review.errorCount, 1);
  assert.equal(review.issues[0]?.issues[0]?.code, "icon-without-name");
  assert.match(review.issues[0]!.announcement, /Unnamed, Button/);
});

test("an EditText without a name is an error", () => {
  const review = reviewAndroidTalkBack([
    {
      role: "android.widget.EditText",
      hittable: true,
      rect: { x: 0, y: 80, width: 300, height: 48 },
      index: 1,
    },
  ]);
  assert.equal(review.issues[0]?.issues[0]?.code, "unnamed-edit");
});

test("a resource-id spoken as the name is a warning", () => {
  const review = reviewAndroidTalkBack([
    {
      description: "app:id/save",
      identifier: "app:id/save",
      role: "android.widget.Button",
      hittable: true,
      rect: { x: 0, y: 0, width: 80, height: 40 },
      index: 0,
    },
  ]);
  assert.equal(review.errorCount, 0);
  assert.equal(review.issues[0]?.issues[0]?.code, "name-is-resource-id");
});

test("duplicate spoken names and parent rows that repeat a child are warnings", () => {
  const review = reviewAndroidTalkBack([
    {
      description: "Settings",
      role: "android.widget.LinearLayout",
      hittable: true,
      rect: { x: 0, y: 100, width: 400, height: 80 },
      index: 0,
    },
    {
      description: "Settings",
      role: "android.widget.Button",
      hittable: true,
      rect: { x: 16, y: 110, width: 200, height: 40 },
      index: 1,
      parentIndex: 0,
    },
  ]);
  const codes = review.issues.flatMap((item) => item.issues.map((issue) => issue.code));
  assert.ok(codes.includes("duplicate-name"));
  assert.ok(codes.includes("parent-repeats-child"));
});

test("a labeled button is not an issue", () => {
  const review = reviewAndroidTalkBack([
    {
      description: "Continue setup",
      value: "Continue",
      role: "android.widget.Button",
      hittable: true,
      rect: { x: 80, y: 1900, width: 920, height: 120 },
      index: 0,
    },
  ]);
  assert.equal(review.errorCount, 0);
  assert.equal(review.warningCount, 0);
  assert.equal(review.items[0]?.announcement, "Continue setup, Button");
});

test("scroll containers without names are not treated as unlabeled controls", () => {
  const review = reviewAndroidTalkBack([
    {
      role: "android.widget.ScrollView",
      hittable: true,
      rect: { x: 0, y: 0, width: 1080, height: 2400 },
      index: 0,
    },
  ]);
  assert.equal(review.items.length, 0);
  assert.equal(review.errorCount, 0);
});
