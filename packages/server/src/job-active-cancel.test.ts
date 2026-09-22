import assert from "node:assert/strict";
import test from "node:test";
import type { TestJob } from "@relay/core";
import { scopedActiveJob } from "./job-routes.js";

function job(partial: Partial<TestJob> & Pick<TestJob, "id">): TestJob {
  return { status: "queued", ...partial } as TestJob;
}

const member = { localTrusted: false, projectId: "project-b", subject: "owner-b" };

test("active cancel ignores another project's earlier job", () => {
  const selected = scopedActiveJob(
    [
      job({ id: "theirs", projectId: "project-a", ownerId: "owner-a", status: "running" }),
      job({ id: "ours", projectId: "project-b", ownerId: "owner-b", status: "queued" }),
    ],
    member,
  );
  assert.equal(selected?.id, "ours");
});

test("active cancel prefers the caller's running job over a later queued one", () => {
  const selected = scopedActiveJob(
    [
      job({ id: "queued-later", projectId: "project-b", ownerId: "owner-b", status: "queued" }),
      job({ id: "running", projectId: "project-b", ownerId: "owner-b", status: "running" }),
    ],
    member,
  );
  assert.equal(selected?.id, "running");
});

test("active cancel matches the requested target only inside the caller's jobs", () => {
  const selected = scopedActiveJob(
    [
      job({
        id: "theirs-browser",
        projectId: "project-a",
        ownerId: "owner-a",
        browserTargetId: "browser-1",
        status: "running",
      }),
      job({
        id: "ours-browser",
        projectId: "project-b",
        ownerId: "owner-b",
        browserTargetId: "browser-1",
        status: "queued",
      }),
    ],
    member,
    "browser-1",
  );
  assert.equal(selected?.id, "ours-browser");
  assert.equal(
    scopedActiveJob(
      [
        job({
          id: "theirs-phone",
          projectId: "project-a",
          ownerId: "owner-a",
          serial: "phone",
          status: "running",
        }),
      ],
      member,
      "phone",
    ),
    undefined,
  );
});

test("a local server still cancels the running job", () => {
  const selected = scopedActiveJob(
    [job({ id: "queued", status: "queued" }), job({ id: "running", status: "running" })],
    { localTrusted: true, projectId: "local", subject: "local" },
  );
  assert.equal(selected?.id, "running");
});
