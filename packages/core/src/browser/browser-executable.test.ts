import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrowserExecutable } from "./browser-executable.js";

test("Linux selects an installed Chromium executable from the server PATH", () => {
  const resolved = resolveBrowserExecutable({
    platform: "linux",
    environment: { PATH: "/opt/browser:/usr/bin" },
    isExecutable: (path) => path === "/usr/bin/chromium",
  });
  assert.equal(resolved.path, "/usr/bin/chromium");
  assert.equal(resolved.configured, false);
  assert.ok(resolved.candidates.every((candidate) => !candidate.includes("/Applications/")));
});

test("an unavailable explicitly configured executable never falls back", () => {
  const resolved = resolveBrowserExecutable({
    platform: "darwin",
    environment: { RELAY_BROWSER_EXECUTABLE: "/missing/browser" },
    isExecutable: () => false,
  });
  assert.equal(resolved.path, undefined);
  assert.deepEqual(resolved.candidates, ["/missing/browser"]);
  assert.equal(resolved.configured, true);
});

test("Windows inspects installed Chrome and Edge paths without running a guessed command", () => {
  const resolved = resolveBrowserExecutable({
    platform: "win32",
    environment: { LOCALAPPDATA: "/windows/user" },
    isExecutable: (path) => path.endsWith("msedge.exe"),
  });
  assert.match(resolved.path ?? "", /Microsoft.*Edge.*msedge.exe/u);
});
