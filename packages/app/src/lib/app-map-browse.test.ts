import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppMap, Connection, Screen } from "@relay/protocol";
import { deriveAppMapAreas } from "./app-map-browse";

const scope = {
  organizationId: "org",
  projectId: "project",
  appMapId: "map",
};

function screen(id: string, title: string, createdAt: number): Screen {
  return { ...scope, id, title, variantIds: [], createdAt, updatedAt: createdAt };
}

function connection(id: string, from: string, to: string): Connection {
  return {
    ...scope,
    id,
    fromScreenId: from,
    destination: { kind: "screen", screenId: to },
    state: "ready",
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function projection(): Pick<AppMap, "screens" | "connections" | "flows"> {
  return {
    screens: {
      home: screen("home", "Home", 1),
      settings: screen("settings", "Settings", 2),
      notifications: screen("notifications", "Notifications", 3),
      privacy: screen("privacy", "Privacy", 4),
      profile: screen("profile", "Profile", 5),
    },
    connections: {
      a: connection("a", "home", "settings"),
      b: connection("b", "settings", "notifications"),
      c: connection("c", "settings", "privacy"),
      d: connection("d", "home", "profile"),
    },
    flows: {
      main: {
        ...scope,
        id: "main",
        name: "Main",
        startScreenId: "home",
        connectionIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
  };
}

describe("deriveAppMapAreas", () => {
  it("groups descendants under first-level product areas", () => {
    const result = deriveAppMapAreas(projection());
    assert.deepEqual(
      result.map((area) => [area.title, area.screenIds]),
      [
        ["Start", ["home"]],
        ["Profile", ["profile"]],
        ["Settings", ["settings", "notifications", "privacy"]],
      ],
    );
  });

  it("keeps disconnected observations visible", () => {
    const input = projection();
    input.screens.orphan = screen("orphan", "Permission dialog", 6);
    assert.deepEqual(deriveAppMapAreas(input).at(-1), {
      id: "area:other",
      title: "Other screens",
      rootScreenId: "orphan",
      screenIds: ["orphan"],
    });
  });
});
