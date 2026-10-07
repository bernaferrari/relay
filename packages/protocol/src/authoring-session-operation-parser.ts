import type { CreateAuthoringSessionInput } from "./authoring.js";
import { fail, number, objectParser, record, string } from "./operation-parser-primitives.js";
import { parseAuthoringDebugOrigin } from "./authoring-capture.js";

/** Canonical runtime parser shared by low-level and durable Authoring begin. */
export const createAuthoringSessionParser = objectParser<CreateAuthoringSessionInput>(
  "create authoring session input",
  (input) => {
    string(input.appMapId, "appMapId");
    if (input.workflowRequestId !== undefined) string(input.workflowRequestId, "workflowRequestId");
    if (input.testName !== undefined) string(input.testName, "testName");
    if (input.originApplication !== undefined) {
      if (!string(input.originApplication, "originApplication").trim()) {
        fail("originApplication", "must be a non-empty string");
      }
    }
    string(input.leaseId, "leaseId");
    const target = record(input.target, "authoring target");
    string(target.targetId, "authoring target targetId");
    if (target.kind !== "device" && target.kind !== "browser") {
      fail("authoring target kind", "must be device or browser");
    }
    if (!(["android", "ios", "browser"] as unknown[]).includes(target.platform)) {
      fail("authoring target platform", "must be android, ios, or browser");
    }
    if (
      (target.kind === "browser" && target.platform !== "browser") ||
      (target.kind === "device" && target.platform === "browser")
    ) {
      fail("authoring target", "kind and platform do not describe the same target");
    }
    if (target.authenticationFixtureId !== undefined) {
      if (target.kind !== "browser") fail("authoring target", "only a browser can sign in");
      string(target.authenticationFixtureId, "authoring target authenticationFixtureId");
    }
    if (target.liveSessionId !== undefined) {
      if (target.kind !== "browser") fail("authoring target", "only a browser has a live session");
      string(target.liveSessionId, "authoring target liveSessionId");
    }
    if (number(input.expectedAppMapRevision, "expectedAppMapRevision") < 0) {
      fail("expectedAppMapRevision", "must be non-negative");
    }
    if (input.sourceScreenId !== undefined) string(input.sourceScreenId, "sourceScreenId");
    if (input.pendingConnectionId !== undefined) {
      string(input.pendingConnectionId, "pendingConnectionId");
    }
    if (input.group !== undefined) string(input.group, "group");
    if (input.debugOrigin !== undefined) parseAuthoringDebugOrigin(input.debugOrigin);
  },
);
