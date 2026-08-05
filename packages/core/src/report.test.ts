import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatJsonReport, toJobReport, toJunitXml, type JobReport } from "./report.js";
import type { TestJob } from "./session.js";

function fakeJob(partial: Partial<TestJob> & Pick<TestJob, "status">): TestJob {
  return {
    id: partial.id ?? "job-1",
    action: (partial.action as TestJob["action"]) ?? "logout",
    title: partial.title ?? "Logout",
    status: partial.status,
    queuedAt: partial.queuedAt ?? 1000,
    startedAt: partial.startedAt ?? 1100,
    finishedAt: partial.finishedAt ?? 2100,
    logs: partial.logs ?? ["==> logout", "==> DONE"],
    attempts: partial.attempts ?? 1,
    steps: partial.steps ?? [],
    frames: partial.frames ?? [],
    glyphs: partial.glyphs ?? ["tap", "ok"],
    kind: partial.kind ?? "Replay",
    tone: partial.tone ?? "dim",
    error: partial.error,
    errorCode: partial.errorCode,
    outcome: partial.outcome,
    failureCategory: partial.failureCategory,
    review: partial.review,
    healed: partial.healed,
    healMessage: partial.healMessage,
    serial: partial.serial,
    deviceName: partial.deviceName,
    platform: partial.platform ?? "android",
    targetProfile: partial.targetProfile,
  } as TestJob;
}

describe("toJobReport", () => {
  it("marks ok for successful jobs", () => {
    const r = toJobReport(fakeJob({ status: "ok" }));
    assert.equal(r.ok, true);
    assert.equal(r.durationMs, 1000);
    assert.equal(r.platform, "android");
    assert.equal(r.outcome, "passed");
  });

  it("retains a frozen compatibility profile in JSON and JUnit output", () => {
    const report = toJobReport(
      fakeJob({
        status: "ok",
        targetProfile: {
          id: "profile-pixel",
          targetId: "pixel-9",
          source: "device",
          platform: "android",
          name: "Pixel 9 · Android 16",
          osVersion: "16",
          capabilities: ["tap"],
          observedAt: 1,
        },
      }),
    );
    assert.equal(report.targetProfile?.name, "Pixel 9 · Android 16");
    assert.match(toJunitXml([report]), /Pixel 9 · Android 16/);
  });

  it("marks ok for healed jobs", () => {
    const r = toJobReport(
      fakeJob({ status: "healed", healed: true, healMessage: "recovered", attempts: 2 }),
    );
    assert.equal(r.ok, true);
    assert.equal(r.healed, true);
  });

  it("marks failed jobs not ok", () => {
    const r = toJobReport(fakeJob({ status: "error", error: "boom", errorCode: "ACTION_FAILED" }));
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "ACTION_FAILED");
    assert.equal(r.outcome, "harness-failure");
  });

  it("keeps deferred checks out of the green path until a human approves them", () => {
    const r = toJobReport(
      fakeJob({
        status: "ok",
        review: {
          schemaVersion: 1,
          status: "pending",
          capability: "camera attachment",
          reason: "The image cannot be inspected in this run.",
          requestedAt: 1,
        },
      }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.outcome, "uncertain");
    assert.match(toJunitXml([r]), /skipped/);
    const approved = toJobReport({
      ...fakeJob({ status: "ok" }),
      outcome: "passed",
      review: {
        schemaVersion: 1,
        status: "approved",
        capability: "camera attachment",
        reason: "The image cannot be inspected in this run.",
        requestedAt: 1,
        decidedAt: 2,
        decidedBy: { id: "human:ada", kind: "human" },
      },
    });
    assert.equal(approved.ok, true);
  });
});

describe("toJunitXml", () => {
  it("emits failure element for failed reports", () => {
    const reports: JobReport[] = [
      toJobReport(fakeJob({ status: "ok", id: "a" })),
      toJobReport(
        fakeJob({ status: "error", id: "b", error: "nope", action: "login-google" as never }),
      ),
    ];
    const xml = toJunitXml(reports);
    assert.match(xml, /tests="2"/);
    assert.match(xml, /failures="1"/);
    assert.match(xml, /<failure/);
    assert.match(xml, /login-google/);
  });

  it("turns an explicitly rejected deferred check into a failure", () => {
    const report = toJobReport({
      ...fakeJob({ status: "ok" }),
      outcome: "uncertain",
      review: {
        schemaVersion: 1,
        status: "rejected",
        capability: "camera attachment",
        reason: "The captured image was not the expected photo.",
        requestedAt: 1,
        decidedAt: 2,
        decidedBy: { id: "human:ada", kind: "human" },
      },
    });
    const xml = toJunitXml([report]);
    assert.match(xml, /failures="1"/);
    assert.match(xml, /<failure/);
  });
});

describe("formatJsonReport", () => {
  it("includes summary counts", () => {
    const json = JSON.parse(
      formatJsonReport([
        toJobReport(fakeJob({ status: "ok" })),
        toJobReport(fakeJob({ status: "healed", healed: true, id: "h" })),
        toJobReport(fakeJob({ status: "error", id: "e", error: "x" })),
      ]),
    );
    assert.equal(json.summary.total, 3);
    assert.equal(json.summary.failed, 1);
    assert.equal(json.summary.healed, 1);
  });
});
