import assert from "node:assert/strict";
import type http from "node:http";
import test from "node:test";
import { livePreviewOperationContext } from "./target-stream-context.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "human:local",
  organizationId: "local",
  projectId: "preview-without-lease",
  allowedProjects: ["preview-without-lease"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};
const request = { headers: {} } as http.IncomingMessage;

test("trusted local preview does not require an earlier control lease", async () => {
  const context = await livePreviewOperationContext(request, scope, "emulator-unleased");
  assert.equal(context.projectId, scope.projectId);
  assert.equal(context.operationId, "target.stream.open");
  assert.equal("leaseId" in context, false);
});

test("remote preview still requires project sharing", async () => {
  await assert.rejects(
    livePreviewOperationContext(
      request,
      { ...scope, localTrusted: false, tokenKind: "service", subject: "service:viewer" },
      "emulator-unleased",
    ),
    /not shared with the current project/,
  );
});
