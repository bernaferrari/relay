import { describe, expect, it } from "vitest";
import {
  admitBrowserTile,
  moveBrowserTile,
  pairedBrowserTiles,
  parseBrowserTiles,
  type BrowserTile,
} from "./browser-workspace";
const tile = (id: string): BrowserTile => ({
  id,
  browserId: id,
  name: id,
  accountName: "Current session",
});
describe("browser workspace isolation", () => {
  it("moves the complete tile identity without mutating the existing order", () => {
    const original = [
      tile("admin"),
      { ...tile("member"), identity: { authenticationFixtureId: "authfx:member:1" } },
      tile("guest"),
    ];
    const moved = moveBrowserTile(original, "member", "guest");
    expect(moved.map((item) => item.id)).toEqual(["admin", "guest", "member"]);
    expect(moved[2]).toBe(original[1]);
    expect(original.map((item) => item.id)).toEqual(["admin", "member", "guest"]);
  });
  it("rejects sharing a live profile between two tiles or accounts", () => {
    expect(() =>
      admitBrowserTile([tile("admin")], {
        ...tile("other"),
        browserId: "admin",
        identity: { signedOut: true },
      }),
    ).toThrow("already open");
    expect(() => admitBrowserTile([tile("admin")], { ...tile("other"), id: "admin" })).toThrow(
      "already open",
    );
    expect(() => admitBrowserTile(["a", "b", "c", "d"].map(tile), tile("e"))).toThrow("four");
  });
  it("retains named account references but drops transient session identities on restore", () => {
    const stored = {
      ...tile("admin"),
      identity: {
        authenticationFixtureId: "authfx:admin:3",
        sessionId: "stale",
        configurationDigest: "stale",
      },
    };
    expect(parseBrowserTiles(JSON.stringify([stored]))).toEqual([
      { ...tile("admin"), identity: { authenticationFixtureId: "authfx:admin:3" } },
    ]);
    expect(() =>
      parseBrowserTiles(
        JSON.stringify([
          {
            ...tile("admin"),
            identity: { signedOut: true, authenticationFixtureId: "authfx:admin:3" },
          },
        ]),
      ),
    ).toThrow("conflicting");
    expect(() => parseBrowserTiles(JSON.stringify([tile("a"), tile("a")]))).toThrow();
  });
  it("opens exactly the declared pairs without crossing their identities", () => {
    expect(
      pairedBrowserTiles({
        schemaVersion: 1,
        updatedAt: 0,
        rows: [
          {
            id: "a",
            name: "Admin",
            browserId: "admin",
            browserName: "Admin",
            accountId: "a",
            accountName: "Admin",
            accountRevision: "3",
            accountReference: "authfx:a:3",
          },
          {
            id: "b",
            name: "Guest",
            browserId: "guest",
            browserName: "Guest",
            signedOutAttested: true,
          },
        ],
      }),
    ).toEqual([
      {
        id: "admin",
        browserId: "admin",
        name: "Admin",
        accountName: "Admin",
        identity: { authenticationFixtureId: "authfx:a:3" },
      },
      {
        id: "guest",
        browserId: "guest",
        name: "Guest",
        accountName: "Signed out",
        identity: { signedOut: true },
      },
    ]);
  });
});
