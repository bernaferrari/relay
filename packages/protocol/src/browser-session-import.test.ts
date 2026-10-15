import assert from "node:assert/strict";
import test from "node:test";
import { parseBrowserSessionImport } from "./browser-session-import.js";

test("normalizes browser exports and preserves Playwright storage state", () => {
  const cookie = {
    name: "session",
    value: "synthetic",
    domain: ".example.test",
    expirationDate: 123,
    sameSite: "no_restriction",
    hostOnly: false,
    storeId: "0",
  };
  const imported = parseBrowserSessionImport(JSON.stringify([cookie]));
  assert.deepEqual(imported, {
    cookies: [
      {
        name: "session",
        value: "synthetic",
        domain: ".example.test",
        expires: 123,
        sameSite: "None",
        path: "/",
        secure: false,
        httpOnly: false,
      },
    ],
    origins: [],
  });
  const state = {
    ...imported,
    origins: [{ origin: "https://example.test", localStorage: [{ name: "theme", value: "dark" }] }],
  };
  assert.deepEqual(parseBrowserSessionImport(JSON.stringify(state)), state);
});

test("rejects malformed, empty, non-web and oversized state without exposing values", () => {
  for (const value of [
    "{",
    "null",
    "[]",
    '{"cookies":[null]}',
    '{"cookies":[{"value":"private-canary"}]}',
    '{"cookies":[],"origins":[{"origin":"file:///private","localStorage":[]}]}',
    " ".repeat(8 * 1024 * 1024 + 1),
  ]) {
    assert.throws(
      () => parseBrowserSessionImport(value),
      (error) => error instanceof Error && !error.message.includes("private-canary"),
    );
  }
});
