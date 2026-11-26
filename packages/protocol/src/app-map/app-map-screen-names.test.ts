import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlaceholderScreenTitle,
  newScreenTitle,
  screenDisplayNames,
  screenStateWord,
} from "./app-map-screen-names.js";

const view = (label: string) => ({ role: "android.widget.TextView", label });
const button = (label: string) => ({ role: "android.widget.Button", label });
const field = (label: string) => ({
  role: "android.widget.EditText",
  label,
  identifier: "prompt_input",
});

test("placeholder titles are recognised", () => {
  assert.equal(isPlaceholderScreenTitle("Next screen"), true);
  assert.equal(isPlaceholderScreenTitle(" Start "), true);
  assert.equal(isPlaceholderScreenTitle("Settings"), false);
});

test("the screen's own controls say what it shows before the move that led there", () => {
  assert.equal(screenStateWord([button("Copy message"), button("Regenerate")]), "reply");
  assert.equal(screenStateWord([button("Stop message"), view("Thinking for 3s")]), "thinking");
  assert.equal(screenStateWord([field("a paper boat")]), "draft");
  assert.equal(screenStateWord([field("prompt_input")]), undefined);
  assert.equal(screenStateWord([button("Download"), button("Share")]), "viewer");
  assert.equal(screenStateWord([], ["Wait until “Done” appears (up to 1 min)"]), "result");
  assert.equal(screenStateWord([], ["Tap “Send prompt”"]), "prompt sent");
  assert.equal(screenStateWord([], ["Continue"]), undefined);
});

test("a new screen is never called Next screen", () => {
  assert.equal(
    newScreenTitle({ sourceTitle: "Chat", nodes: [button("Copy message")] }),
    "Chat reply",
  );
  assert.equal(newScreenTitle({ sourceTitle: "Next screen" }), "Unnamed screen");
  assert.equal(newScreenTitle({ sourceTitle: "Home" }), "After Home");
});

test("placeholder and button-named screens get an area and a state; siblings differ", () => {
  const names = screenDisplayNames({
    entryIds: ["home"],
    screens: [
      { id: "home", title: "Home", nodes: [view("Imagine"), view("Ask")] },
      { id: "imagine", title: "Imagine", nodes: [view("Imagine"), view("Type to imagine")] },
      { id: "speed", title: "Speed", nodes: [view("Imagine"), view("Speed")] },
      {
        id: "draft-a",
        title: "Next screen",
        createdAt: 1,
        nodes: [view("Imagine"), view("Speed"), field("a small paper boat on a pond")],
      },
      {
        id: "draft-b",
        title: "Next screen",
        createdAt: 2,
        nodes: [view("Imagine"), view("Speed"), field("a tiny paper boat on a lake")],
      },
      { id: "sent", title: "Send prompt", nodes: [view("Imagine")] },
      { id: "result", title: "Next screen", nodes: [view("Imagine"), button("Make video")] },
      { id: "photo", title: "Next screen", nodes: [button("Download"), button("Share")] },
      { id: "drawer", title: "Show navigation drawer", nodes: [view("Settings")] },
      { id: "settings", title: "Settings", nodes: [view("Settings")] },
    ],
    paths: [
      { from: "home", to: "imagine", label: "Tap “Imagine”" },
      { from: "imagine", to: "speed", label: "Tap “Speed”" },
      { from: "speed", to: "draft-a", label: "Type text" },
      { from: "speed", to: "draft-b", label: "Type text" },
      { from: "draft-a", to: "sent", label: "Tap “Send prompt”" },
      { from: "sent", to: "result", label: "Wait until “Make video” appears" },
      { from: "result", to: "photo", label: "Continue" },
      { from: "home", to: "drawer", label: "Tap “Show navigation drawer”" },
      { from: "drawer", to: "settings", label: "Settings" },
      { from: "settings", to: "home", label: "Close" },
    ],
  });
  assert.equal(names.get("home"), "Home");
  assert.equal(names.get("speed"), "Speed");
  assert.equal(names.get("draft-a"), "Imagine draft “a small paper boat…”");
  assert.equal(names.get("draft-b"), "Imagine draft “a tiny paper boat…”");
  assert.equal(names.get("sent"), "Imagine prompt sent");
  assert.equal(names.get("result"), "Imagine result");
  assert.equal(names.get("photo"), "Imagine viewer");
  assert.equal(names.get("drawer"), "Navigation drawer");
  assert.ok(![...names.values()].some((name) => /next screen/iu.test(name)));
});

test("a button-named screen with nothing better keeps its name", () => {
  const names = screenDisplayNames({
    screens: [
      { id: "home", title: "Home", nodes: [] },
      { id: "compose", title: "Type to imagine", nodes: [view("Type to make image")] },
    ],
    paths: [{ from: "home", to: "compose", label: "Tap “Type to imagine”" }],
  });
  assert.equal(names.get("compose"), "Type to imagine");
});
