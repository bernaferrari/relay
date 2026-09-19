import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceDoctorReport } from "./workspace-doctor.mjs";

function probe({ executable = true, commands = new Set() } = {}) {
  return {
    isExecutable: () => executable,
    isCommandAvailable: (command) => commands.has(command),
  };
}

test("doctor reports a ready browser workspace without mutating host state", () => {
  const report = buildWorkspaceDoctorReport({
    nodeVersion: "v24.21.0",
    platform: "linux",
    ...probe({ commands: new Set(["google-chrome", "adb"]) }),
  });
  assert.equal(report.ready, true);
  assert.equal(report.browser.ready, true);
  assert.equal(report.android.ready, true);
  assert.deepEqual(report.failures, []);
});

test("doctor distinguishes required workspace failures from optional target warnings", () => {
  const report = buildWorkspaceDoctorReport({
    nodeVersion: "v22.0.0",
    platform: "darwin",
    ...probe({ executable: false }),
  });
  assert.equal(report.ready, false);
  assert.equal(report.node.ready, false);
  assert.ok(report.failures.some((failure) => failure.includes("Node.js 24+")));
  assert.ok(report.failures.some((failure) => failure.includes("dependencies are missing")));
  assert.ok(report.warnings.some((warning) => warning.includes("Chromium")));
  assert.ok(report.warnings.some((warning) => warning.includes("adb")));
  assert.ok(report.warnings.some((warning) => warning.includes("Apple developer tools")));
});

test("doctor emits a stable machine-readable contract for unsupported host platforms", () => {
  const report = buildWorkspaceDoctorReport({
    nodeVersion: "v24.21.0",
    platform: "freebsd",
    ...probe({ commands: new Set(["chromium"]) }),
  });
  assert.equal(report.ready, true);
  assert.equal(report.ios.ready, false);
  assert.deepEqual(report.browser.available, ["chromium"]);
});
