import assert from "node:assert/strict";
import test from "node:test";
import { liveEventVisible, type LiveEventScope } from "./live-event-scope.js";

const member: LiveEventScope = {
  organizationId: "org-1",
  projectId: "project-b",
  subject: "owner-b",
  localTrusted: false,
};

const jobs = new Map<string, { projectId?: string; ownerId?: string }>([
  ["ours", { projectId: "project-b", ownerId: "owner-b" }],
  ["theirs", { projectId: "project-b", ownerId: "owner-a" }],
]);

test("a job error is visible only to that job's owner", () => {
  const event = {
    organizationId: "org-1",
    projectId: "project-b",
    payload: { type: "error", message: "Member fixture expired", jobId: "ours" },
  };
  assert.equal(
    liveEventVisible(event, member, (id) => jobs.get(id)),
    true,
  );
  assert.equal(
    liveEventVisible(
      { ...event, payload: { ...event.payload, jobId: "theirs" } },
      member,
      (id) => jobs.get(id),
    ),
    false,
  );
});

test("an unowned error or screenshot is not broadcast inside the project", () => {
  for (const type of ["error", "screenshot.captured", "snapshot.captured"]) {
    assert.equal(
      liveEventVisible(
        { organizationId: "org-1", projectId: "project-b", payload: { type } },
        member,
        () => undefined,
      ),
      false,
    );
  }
  assert.equal(
    liveEventVisible(
      {
        organizationId: "org-1",
        projectId: "project-b",
        payload: { type: "error" },
      },
      { ...member, localTrusted: true },
      () => undefined,
    ),
    true,
  );
});

test("another project's event is hidden even when it names this owner", () => {
  assert.equal(
    liveEventVisible(
      {
        organizationId: "org-1",
        projectId: "project-a",
        payload: { type: "job.finished", jobId: "ours" },
      },
      member,
      (id) => jobs.get(id),
    ),
    false,
  );
});
