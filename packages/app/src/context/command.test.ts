import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  commandComboboxAttributes,
  commandOptionId,
  commandResultAnnouncement,
  commandResultsId,
  matchesKeybind,
} from "./command";

test("command combobox relationships resolve to stable listbox and option ids", () => {
  const window = new Window();
  try {
    const input = window.document.createElement("input");
    const list = window.document.createElement("div");
    const option = window.document.createElement("button");
    list.id = commandResultsId;
    option.id = commandOptionId("app-map.demo/screen.settings");
    list.append(option);
    const attributes = commandComboboxAttributes("app-map.demo/screen.settings");
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== undefined) input.setAttribute(name, String(value));
    }
    window.document.body.append(input, list);

    assert.equal(input.getAttribute("aria-controls"), "relay-command-results");
    assert.equal(input.getAttribute("role"), "combobox");
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.equal(input.getAttribute("aria-haspopup"), "listbox");
    assert.equal(input.getAttribute("aria-autocomplete"), "list");
    assert.equal(window.document.getElementById(input.getAttribute("aria-controls")!), list);
    assert.equal(
      window.document.getElementById(input.getAttribute("aria-activedescendant")!),
      option,
    );
    assert.equal(commandOptionId("app-map.demo/screen.settings"), option.id);
    assert.notEqual(commandOptionId("app-map.demo/screen"), commandOptionId("app-map.demo-screen"));
    assert.equal(commandResultAnnouncement(0), "0 commands available");
    assert.equal(commandResultAnnouncement(1), "1 command available");
    assert.equal(commandResultAnnouncement(12), "12 commands available");
  } finally {
    window.close();
  }
});

test("palette key matching preserves Escape and arrow navigation", () => {
  const window = new Window();
  try {
    assert.equal(
      matchesKeybind(
        "escape",
        new window.KeyboardEvent("keydown", { key: "Escape" }) as unknown as KeyboardEvent,
      ),
      true,
    );
    assert.equal(
      matchesKeybind(
        "down",
        new window.KeyboardEvent("keydown", { key: "ArrowDown" }) as unknown as KeyboardEvent,
      ),
      true,
    );
  } finally {
    window.close();
  }
});
