import assert from "node:assert/strict";
import test from "node:test";
import { listAuditEvents, recordAudit, type RequestContext } from "./security.js";

function scope(projectId: string): RequestContext {
  return {
    subject: `owner-${projectId}`,
    organizationId: "org-1",
    projectId,
    allowedProjects: [projectId],
    tokenKind: "service",
    localTrusted: false,
    role: "admin",
  };
}

test("an audit read does not include another project's events", () => {
  const action = `audit.scope.${Date.now()}`;
  recordAudit(scope("project-a"), { action, resource: "secret-a", result: "allow" });
  recordAudit(scope("project-b"), { action, resource: "secret-b", result: "deny" });

  const visible = listAuditEvents(1_000, {
    organizationId: "org-1",
    projectId: "project-b",
    localTrusted: false,
  }).filter((event) => event.action === action);

  assert.deepEqual(
    visible.map((event) => event.resource),
    ["secret-b"],
  );
  assert.equal(
    listAuditEvents(1_000, {
      organizationId: "org-1",
      projectId: "project-a",
      localTrusted: true,
    }).filter((event) => event.action === action).length,
    2,
  );
});
