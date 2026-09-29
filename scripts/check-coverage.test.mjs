import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  changedFiles,
  coverageBase,
  evaluateChangedCoverage,
  parseLcov,
} from "./check-coverage.mjs";

test("committed changes are selected from the base in a clean checkout", (t) => {
  const root = mkdtempSync(join(tmpdir(), "relay-coverage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Relay Test");
  git("config", "user.email", "relay-test@example.invalid");
  git("config", "core.hooksPath", join(root, "no-hooks"));
  writeFileSync(join(root, "source.ts"), "export const value = 1;\n");
  git("add", "source.ts");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
  git("add", "source.ts");
  git("commit", "-qm", "change");

  assert.deepEqual(changedFiles(base, root), ["source.ts"]);
  assert.deepEqual(changedFiles(undefined, root), []);
  assert.equal(coverageBase(undefined, true, root), base);
  assert.throws(() => coverageBase("0".repeat(40), true, root), /newly created branch/u);

  git("rm", "source.ts");
  git("commit", "-qm", "delete");
  assert.deepEqual(changedFiles(base, root), []);
});

test("LCOV source paths resolve within their package", () => {
  const report = parseLcov(
    "SF:src/example.ts\nLF:10\nLH:8\nend_of_record\nSF:../server/src/other.ts\nLF:10\nLH:2\nend_of_record\n",
    "core",
    "/repo",
  );
  assert.deepEqual(report.get("packages/core/src/example.ts"), { found: 10, hit: 8 });
  assert.equal(report.size, 1);
});

test("changed source coverage passes only when it meets the threshold", () => {
  const changed = ["packages/core/src/example.ts"];
  const packages = new Set(["core"]);
  const passing = new Map([[changed[0], { found: 10, hit: 8 }]]);
  const failing = new Map([[changed[0], { found: 10, hit: 6 }]]);
  assert.equal(evaluateChangedCoverage(changed, passing, packages).passed, true);
  assert.equal(evaluateChangedCoverage(changed, failing, packages).passed, false);
});

test("a changed source file absent from LCOV fails instead of disappearing", () => {
  const result = evaluateChangedCoverage(
    ["packages/core/src/untested.ts"],
    new Map(),
    new Set(["core"]),
  );
  assert.deepEqual(result.missing, ["packages/core/src/untested.ts"]);
  assert.equal(result.passed, false);
});

test("test files and packages without a coverage script are outside the measured set", () => {
  const result = evaluateChangedCoverage(
    ["packages/core/src/example.test.ts", "packages/app/src/page.tsx"],
    new Map(),
    new Set(["core"]),
  );
  assert.deepEqual(result.sourceFiles, []);
  assert.equal(result.passed, true);
});
