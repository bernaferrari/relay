import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "../operations.js";

const fence = { workflowId: "workflow-1", expectedVersion: 1 };

function parse(body: Record<string, unknown>) {
  return operationDefinition("workflow.transition").input.parse({ ...fence, ...body });
}

test("workflow.transition accepts record and repeat attach branches", () => {
  const record = parse({
    action: "authoring-record",
    interaction: { kind: "wait", ms: 1 },
    mutationId: "mutation-1",
  });
  assert.equal(record.action, "authoring-record");
  const attach = parse({ action: "attach-repeat", campaignId: "campaign-1" });
  assert.equal(attach.campaignId, "campaign-1");
  const approve = parse({ action: "authoring-approve", testName: "Checkout" });
  assert.equal(approve.testName, "Checkout");
});

test("workflow.transition rejects missing required branch fields with diagnostics", () => {
  assert.throws(
    () => parse({ action: "authoring-record" }),
    (error: unknown) => error instanceof Error && /interaction/.test(error.message),
  );
  assert.throws(
    () => parse({ action: "attach-repeat" }),
    (error: unknown) => error instanceof Error && /campaignId/.test(error.message),
  );
});

test("workflow.transition rejects extraneous branch fields", () => {
  assert.throws(() => parse({ action: "cancel-run", jobId: "job-1" }));
  assert.throws(() => parse({ action: "authoring-stop", label: "nope" }));
  assert.throws(() => parse({ action: "attach-run" }));
  const accepted = parse({ action: "attach-run", jobId: "job-1" });
  assert.equal(accepted.jobId, "job-1");
});
