import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppMap, Connection, Screen } from "@relay/protocol";
import {
  screenConnectivityLabel,
  screenDirectory,
  screenDirectoryFromGraph,
} from "./app-map-screen-directory";

function screen(id: string, title: string): Screen {
  return {
    id,
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    title,
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  } as Screen;
}

function edge(id: string, from: string, to: string): Connection {
  return {
    id,
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    fromScreenId: from,
    destination: { kind: "screen", screenId: to },
    state: "ready",
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  } as Connection;
}

function mapOf(screens: Screen[], connections: Connection[]): AppMap {
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Map",
    revision: 0,
    notes: {},
    groups: {},
    screens: Object.fromEntries(screens.map((item) => [item.id, item])),
    screenVariants: {},
    connections: Object.fromEntries(connections.map((item) => [item.id, item])),
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  } as AppMap;
}

describe("screenDirectory", () => {
  it("counts both directions in one pass over the connections", () => {
    const directory = screenDirectory(
      mapOf(
        [screen("home", "Home"), screen("settings", "Settings"), screen("about", "About")],
        [edge("a", "home", "settings"), edge("b", "settings", "about"), edge("c", "home", "about")],
      ),
    );
    assert.deepEqual(directory.home, { incoming: 0, outgoing: 2, reachedFrom: [] });
    assert.equal(directory.about?.incoming, 2);
    assert.deepEqual(directory.about?.reachedFrom, ["Settings", "Home"]);
  });

  it("leaves a unique title unqualified", () => {
    const directory = screenDirectory(mapOf([screen("home", "Home")], []));
    assert.equal(directory.home?.qualifier, undefined);
  });

  it("tells repeated titles apart by where a person arrives from", () => {
    const directory = screenDirectory(
      mapOf(
        [
          screen("home", "Home"),
          screen("settings", "Settings"),
          screen("ask-a", "Ask"),
          screen("ask-b", "Ask"),
        ],
        [edge("a", "home", "ask-a"), edge("b", "settings", "ask-b")],
      ),
    );
    assert.equal(directory["ask-a"]?.qualifier, "from Home");
    assert.equal(directory["ask-b"]?.qualifier, "from Settings");
  });

  it("falls back to an ordinal when the sources do not tell them apart", () => {
    const directory = screenDirectory(
      mapOf(
        [screen("home", "Home"), screen("ask-a", "Ask"), screen("ask-b", "Ask")],
        [edge("a", "home", "ask-a"), edge("b", "home", "ask-b")],
      ),
    );
    assert.equal(directory["ask-a"]?.qualifier, "1 of 2");
    assert.equal(directory["ask-b"]?.qualifier, "2 of 2");
  });

  it("ignores connections that leave the screen graph", () => {
    const directory = screenDirectory(
      mapOf(
        [screen("home", "Home")],
        [
          {
            ...edge("out", "home", "home"),
            destination: { kind: "end" },
          } as Connection,
        ],
      ),
    );
    assert.deepEqual(directory.home, { incoming: 0, outgoing: 1, reachedFrom: [] });
  });

  it("groups duplicates by the name the surface paints, not the stored one", () => {
    const directory = screenDirectory(
      mapOf([screen("a", "settings_button"), screen("b", "Settings button")], []),
      (id) => (id === "a" ? "Settings button" : "Settings button"),
    );
    assert.equal(directory.a?.qualifier, "1 of 2");
    assert.equal(directory.b?.qualifier, "2 of 2");
  });
});

describe("screenDirectoryFromGraph", () => {
  it("qualifies canvas frames from canvas names and canvas edges", () => {
    const titles: Record<string, string> = {
      home: "Home",
      settings: "Settings",
      "look-a": "Appearance",
      "look-b": "Appearance",
    };
    const directory = screenDirectoryFromGraph({
      screenIds: Object.keys(titles),
      titleFor: (id) => titles[id] ?? "",
      edges: [
        { from: "home", to: "look-a" },
        { from: "settings", to: "look-b" },
      ],
    });
    assert.equal(directory["look-a"]?.qualifier, "from Home");
    assert.equal(directory["look-b"]?.qualifier, "from Settings");
    assert.equal(directory.home?.qualifier, undefined);
  });

  it("follows a canvas rename, so a renamed frame stops being a duplicate", () => {
    const titles: Record<string, string> = { "look-a": "Appearance", "look-b": "Dark mode" };
    const directory = screenDirectoryFromGraph({
      screenIds: Object.keys(titles),
      titleFor: (id) => titles[id] ?? "",
      edges: [],
    });
    assert.equal(directory["look-a"]?.qualifier, undefined);
    assert.equal(directory["look-b"]?.qualifier, undefined);
  });
});

describe("screenConnectivityLabel", () => {
  it("speaks about screens, not about paths in and out", () => {
    assert.equal(
      screenConnectivityLabel({ incoming: 3, outgoing: 5, isStart: false }),
      "Reached from 3 · Leads to 5",
    );
  });
  it("names the start screen instead of counting nothing", () => {
    assert.equal(
      screenConnectivityLabel({ incoming: 0, outgoing: 2, isStart: true }),
      "Start screen · Leads to 2",
    );
  });
  it("says a dead end is unfinished rather than final", () => {
    assert.equal(
      screenConnectivityLabel({ incoming: 0, outgoing: 0, isStart: false }),
      "Not reached yet · No exits yet",
    );
  });
  it("stays short enough to fit a tile as narrow as the phone it shows", () => {
    // A portrait tile is about 33 characters wide at caption size. The line
    // truncating is worse than the line being terse, because the words that
    // get cut are the ones that say something is unfinished.
    for (const entry of [
      { incoming: 0, outgoing: 0, isStart: false },
      { incoming: 12, outgoing: 0, isStart: false },
      { incoming: 0, outgoing: 11, isStart: true },
    ]) {
      assert.ok(
        screenConnectivityLabel(entry).length <= 33,
        `too long for a portrait tile: ${screenConnectivityLabel(entry)}`,
      );
    }
  });
});
