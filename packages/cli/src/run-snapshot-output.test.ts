import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import { CliOutput } from "./output.js";

function memory() {
  let stdout = "";
  const streams = {
    stdout: new Writable({
      write(chunk, _encoding, callback) {
        stdout += String(chunk);
        callback();
      },
    }),
    stderr: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  };
  return { streams, text: () => stdout };
}

test("a finished run says how many screenshots are awaiting review", () => {
  const io = memory();
  new CliOutput("human", false, io.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    phase: "completed",
    progress: { label: "Screenshot captured", completed: 4, total: 4 },
    review: { pending: 1, decided: 3 },
    frozen: {
      engine: "chrome",
      account: { kind: "fixture", accountId: "member", accountRevision: "8" },
    },
  });
  assert.match(io.text(), /Account settings/u);
  assert.match(io.text(), /chrome · member/u);
  assert.equal(io.text().includes("8"), false);
  assert.match(io.text(), /Screenshot captured/u);
  assert.match(io.text(), /✓ 4 of 4/u);
  assert.match(io.text(), /1 screenshot awaiting review/u);
  assert.equal(io.text().includes("{"), false);
});

test("a blocked run names the problem without dumping the snapshot", () => {
  const io = memory();
  new CliOutput("human", false, io.streams).result("run.inspect", {
    kind: "run-test",
    phase: "blocked",
    progress: { completed: 4, total: 4 },
    frozen: { engine: "webkit", account: { kind: "signed-out", attested: true } },
    problems: [
      {
        title: "Member sign-in expired",
        detail: "Completed captures are preserved.",
        recovery: "Refresh the sign-in, then resume this activity.",
      },
    ],
  });
  assert.match(io.text(), /webkit · Signed out/u);
  assert.match(io.text(), /Could not continue: Member sign-in expired/u);
  assert.match(io.text(), /· 4 of 4/u);
  assert.equal(io.text().includes("✓"), false);
  assert.match(io.text(), /Refresh the sign-in, then resume this activity/u);
  assert.match(io.text(), /Completed captures are preserved/u);
  assert.equal(io.text().includes("{"), false);
});

test("an unfinished run is not marked complete, and an empty count is omitted", () => {
  const unfinished = memory();
  new CliOutput("human", false, unfinished.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    progress: { completed: 2, total: 4 },
  });
  assert.match(unfinished.text(), /· 2 of 4/u);
  assert.equal(unfinished.text().includes("✓"), false);

  const empty = memory();
  new CliOutput("human", false, empty.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    progress: { completed: 0, total: 0 },
  });
  assert.equal(empty.text().includes("0 of 0"), false);
  assert.equal(empty.text().includes("✓"), false);
});

test("a negative step count is omitted", () => {
  const io = memory();
  new CliOutput("human", false, io.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    progress: { completed: -1, total: 4 },
  });
  assert.equal(io.text().includes("-1"), false);
  assert.equal(io.text().includes("of 4"), false);
});

test("a fractional step count is omitted", () => {
  const io = memory();
  new CliOutput("human", false, io.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    progress: { completed: 1.5, total: 4 },
  });
  assert.equal(io.text().includes("1.5"), false);
  assert.equal(io.text().includes("of 4"), false);
});

test("a finished run that still needs review does not say it could not continue", () => {
  const io = memory();
  new CliOutput("human", false, io.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    phase: "completed",
    progress: { completed: 4, total: 4 },
    review: { pending: 1, decided: 3 },
    problems: [{ title: "Review is still open", detail: "Look at the screenshot." }],
  });
  assert.match(io.text(), /✓ 4 of 4/u);
  assert.match(io.text(), /1 screenshot awaiting review/u);
  assert.equal(io.text().includes("Could not continue"), false);
});

test("a blocked run with no problem title is not marked finished", () => {
  const io = memory();
  new CliOutput("human", false, io.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    phase: "blocked",
    progress: { completed: 4, total: 4 },
  });
  assert.match(io.text(), /· 4 of 4/u);
  assert.equal(io.text().includes("✓"), false);
  assert.equal(io.text().includes("Could not continue"), false);
});

test("a run that needs attention is not marked finished", () => {
  const io = memory();
  new CliOutput("human", false, io.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    phase: "needs-attention",
    progress: { completed: 4, total: 4 },
    problems: [{ title: "The runner stopped responding", detail: "Reconnect, then resume." }],
  });
  assert.match(io.text(), /· 4 of 4/u);
  assert.match(io.text(), /Could not continue: The runner stopped responding/u);
  assert.equal(io.text().includes("✓"), false);
});

test("a running run is not marked finished when the counted steps are full", () => {
  const io = memory();
  new CliOutput("human", false, io.streams).result("run.inspect", {
    kind: "run-test",
    title: "Account settings",
    phase: "running",
    progress: { completed: 4, total: 4 },
  });
  assert.match(io.text(), /· 4 of 4/u);
  assert.equal(io.text().includes("✓"), false);
});
