import { assertIosSessionOperationLifecycle } from "./ios-session-lifecycle.js";
import type { OperationInput, TargetScreenshotDto, TargetSnapshotDto } from "./operation-map.js";
import type { OperationRecord } from "./operation-contract.js";
import { boolean, fail, number, objectParser, record, string } from "./operation-parser-primitives.js";

export function createTargetCaptureOperationParsers(input: {
  assertTargetRuntimeReadiness(value: unknown, label: string): void;
}) {
  function optionalQueryBoolean(value: unknown, label: string): void {
    if (value === undefined) return;
    if (value === true || value === false) return;
    if (value === "true" || value === "false" || value === "1" || value === "0") return;
    fail(label, "must be a boolean");
  }

  const targetInputParser = objectParser<OperationRecord>("target operation", (value) => {
    string(value.serial, "target serial");
    if (value.previewX !== undefined) number(value.previewX, "previewX");
    if (value.previewY !== undefined) number(value.previewY, "previewY");
    if (value.preview !== undefined) boolean(value.preview, "preview");
    optionalQueryBoolean(value.visual, "visual");
  });

  const targetScreenshotInputParser = objectParser<OperationInput<"target.screenshot.capture">>(
    "target screenshot input",
    (value) => {
      targetInputParser.parse(value);
      if (value.caption !== undefined) string(value.caption, "screenshot caption");
      if (value.jobId !== undefined) string(value.jobId, "screenshot jobId");
      optionalQueryBoolean(value.ephemeral, "screenshot ephemeral");
    },
  );

  const targetSnapshotInputParser = objectParser<OperationInput<"target.snapshot.capture">>(
    "target snapshot input",
    (value) => {
      targetInputParser.parse(value);
      optionalQueryBoolean(value.full, "full");
      optionalQueryBoolean(value.interactiveOnly, "interactiveOnly");
    },
  );

  const screenshotParser = objectParser<TargetScreenshotDto>("screenshot response", (value) => {
    string(value.base64, "screenshot base64");
    string(value.mime, "screenshot mime");
    string(value.path, "screenshot path");
    number(value.bytes, "screenshot bytes");
    number(value.capturedAt, "screenshot capturedAt");
    if (value.readiness !== undefined) {
      input.assertTargetRuntimeReadiness(value.readiness, "screenshot readiness");
    }
  });

  const targetSnapshotOutputParser = objectParser<TargetSnapshotDto>(
    "target snapshot response",
    (value) => {
      if (!Array.isArray(value.nodes)) fail("snapshot nodes", "must be an array");
      if (!Array.isArray(value.interactive)) fail("snapshot interactive", "must be an array");
      number(value.capturedAt, "snapshot capturedAt");
      boolean(value.inspectable, "snapshot inspectable");
      string(value.source, "snapshot source");
      record(value.screenIdentity, "snapshot screenIdentity");
      if (typeof value.tree !== "string") fail("snapshot tree", "must be a string");
      if (!value.tree && value.inspectable !== false) {
        fail("snapshot tree", "must be non-empty unless the snapshot is explicitly uninspectable");
      }
      if (value.readiness !== undefined) {
        input.assertTargetRuntimeReadiness(value.readiness, "snapshot readiness");
      }
      if (value.iosSessionLifecycle !== undefined) {
        assertIosSessionOperationLifecycle(value.iosSessionLifecycle, "snapshot iOS session lifecycle");
      }
    },
  );

  return { screenshotParser, targetSnapshotOutputParser, targetScreenshotInputParser, targetSnapshotInputParser };
}
