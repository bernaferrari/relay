import { assertIosSessionOperationLifecycle } from "./ios-session-lifecycle.js";
import type {
  OperationInput,
  OperationOutput,
  ScrollSurveyStopReasonDto,
  TargetScreenshotDto,
  TargetSnapshotDto,
} from "./operation-map.js";
import type { OperationRecord } from "./operation-contract.js";
import {
  boolean,
  fail,
  number,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";
import { createTargetObservationOperationDefinition } from "./target-observation-operation-definition.js";

const scrollSurveyReasons = new Set<ScrollSurveyStopReasonDto>([
  "end-of-content",
  "screen-changed",
  "inspection-unavailable",
  "missing-page-anchor",
  "seam-ambiguous",
  "dimension-changed",
  "scroll-failed",
  "restore-failed",
  "start-viewport-unproven",
  "extent-unproven",
  "limit-reached",
]);

function assertScrollSurveyRect(value: unknown, label: string): void {
  const rect = record(value, label);
  number(rect.x, `${label} x`);
  number(rect.y, `${label} y`);
  number(rect.width, `${label} width`);
  number(rect.height, `${label} height`);
}

function assertScrollSurveyNode(value: unknown, label: string): void {
  const node = record(value, label);
  for (const field of ["index", "depth", "parentIndex"]) {
    if (node[field] !== undefined && !Number.isInteger(number(node[field], `${label} ${field}`))) {
      fail(`${label} ${field}`, "must be an integer");
    }
  }
  if (node.rect !== undefined) assertScrollSurveyRect(node.rect, `${label} rect`);
}

function assertScrollSurveySnapshot(value: unknown, label: string): void {
  const snapshot = record(value, label);
  if (snapshot.serial !== undefined) string(snapshot.serial, `${label} serial`);
  number(snapshot.capturedAt, `${label} capturedAt`);
  if (!Array.isArray(snapshot.nodes)) fail(`${label} nodes`, "must be an array");
  snapshot.nodes.forEach((node, index) => assertScrollSurveyNode(node, `${label} node ${index}`));
  if (!Array.isArray(snapshot.interactive)) fail(`${label} interactive`, "must be an array");
  snapshot.interactive.forEach((node, index) =>
    assertScrollSurveyNode(node, `${label} interactive node ${index}`),
  );
  if (snapshot.bounds !== undefined) {
    const bounds = record(snapshot.bounds, `${label} bounds`);
    number(bounds.width, `${label} bounds width`);
    number(bounds.height, `${label} bounds height`);
  }
  boolean(snapshot.inspectable, `${label} inspectable`);
  if (!["sdk", "android-system", "pixels-only"].includes(String(snapshot.source))) {
    fail(`${label} source`, "must be sdk, android-system, or pixels-only");
  }
  if (
    snapshot.androidTreeBackend !== undefined &&
    !["helper", "dump"].includes(String(snapshot.androidTreeBackend))
  ) {
    fail(`${label} androidTreeBackend`, "must be helper or dump");
  }
  if (
    snapshot.inspectionState !== undefined &&
    !["active", "keyguard", "asleep", "unavailable", "unknown"].includes(
      String(snapshot.inspectionState),
    )
  ) {
    fail(`${label} inspectionState`, "is unsupported");
  }
  if (
    snapshot.bindingState !== undefined &&
    !["matched", "rebound", "unavailable"].includes(String(snapshot.bindingState))
  ) {
    fail(`${label} bindingState`, "is unsupported");
  }
  record(snapshot.screenIdentity, `${label} screenIdentity`);
  if (snapshot.proposedRows !== undefined) {
    if (!Array.isArray(snapshot.proposedRows)) fail(`${label} proposedRows`, "must be an array");
    snapshot.proposedRows.forEach((value, index) => {
      const row = record(value, `${label} proposed row ${index}`);
      number(row.x, `${label} proposed row ${index} x`);
      number(row.y, `${label} proposed row ${index} y`);
    });
  }
}

function assertScrollSurveyFrame(value: unknown, index: number, diagnostic = false): void {
  const label = `scroll survey ${diagnostic ? "diagnostic " : ""}frame ${index}`;
  const frame = record(value, label);
  if (!Number.isInteger(number(frame.index, `${label} index`))) {
    fail(`${label} index`, "must be an integer");
  }
  number(frame.offsetY, `${label} offsetY`);
  number(frame.appendedHeight, `${label} appendedHeight`);
  const screenshot = record(frame.screenshot, `${label} screenshot`);
  string(screenshot.base64, `${label} screenshot base64`);
  number(screenshot.width, `${label} screenshot width`);
  number(screenshot.height, `${label} screenshot height`);
  number(screenshot.capturedAt, `${label} screenshot capturedAt`);
  assertScrollSurveySnapshot(frame.snapshot, `${label} snapshot`);
}

const targetScrollSurveyInputParser = objectParser<OperationInput<"target.scroll-survey.capture">>(
  "scroll survey input",
  (input) => {
    if (typeof input.serial !== "string" || !input.serial.trim()) {
      fail("scroll survey serial", "must be a non-empty string");
    }
    if (
      input.maxScrolls !== undefined &&
      (typeof input.maxScrolls !== "number" ||
        !Number.isInteger(input.maxScrolls) ||
        input.maxScrolls < 1 ||
        input.maxScrolls > 12)
    ) {
      fail("scroll survey maxScrolls", "must be an integer between 1 and 12");
    }
    if (input.restore !== undefined && typeof input.restore !== "boolean") {
      fail("scroll survey restore", "must be a boolean");
    }
    if (input.dir !== undefined) {
      if (typeof input.dir !== "string" || !input.dir.trim()) {
        fail("scroll survey dir", "must be a non-empty folder path");
      }
    }
    if (input.force !== undefined && typeof input.force !== "boolean") {
      fail("scroll survey force", "must be a boolean");
    }
  },
);

const targetScrollSurveyOutputParser = objectParser<
  OperationOutput<"target.scroll-survey.capture">
>("scroll survey response", (input) => {
  if (input.status !== "completed" && input.status !== "stopped") {
    fail("scroll survey status", "must be completed or stopped");
  }
  if (!scrollSurveyReasons.has(input.reason as ScrollSurveyStopReasonDto)) {
    fail("scroll survey reason", "is unsupported");
  }
  if (!Array.isArray(input.frames) || input.frames.length === 0) {
    fail("scroll survey frames", "must be a non-empty array");
  }
  input.frames.forEach((value, index) => assertScrollSurveyFrame(value, index));
  if (!Array.isArray(input.diagnosticFrames)) {
    fail("scroll survey diagnosticFrames", "must be an array");
  }
  input.diagnosticFrames.forEach((value, index) => assertScrollSurveyFrame(value, index, true));
  if (input.stitched !== undefined) {
    const stitched = record(input.stitched, "scroll survey stitched preview");
    string(stitched.base64, "scroll survey stitched preview base64");
    number(stitched.width, "scroll survey stitched preview width");
    number(stitched.height, "scroll survey stitched preview height");
    if (stitched.mime !== "image/png") {
      fail("scroll survey stitched preview mime", "must be image/png");
    }
  }
  if (!Array.isArray(input.mergedNodes)) fail("scroll survey mergedNodes", "must be an array");
  input.mergedNodes.forEach((node, index) =>
    assertScrollSurveyNode(node, `scroll survey merged node ${index}`),
  );
  boolean(input.restoredStartViewport, "scroll survey restoredStartViewport");
  string(input.message, "scroll survey message");
  if (input.persist !== undefined) {
    const persist = record(input.persist, "scroll survey persist");
    string(persist.dir, "scroll survey persist dir");
    if (
      persist.status !== undefined &&
      persist.status !== "completed" &&
      persist.status !== "stopped"
    ) {
      fail("scroll survey persist status", "must be completed or stopped");
    }
    if (persist.reason !== undefined) string(persist.reason, "scroll survey persist reason");
    if (persist.frameCount !== undefined)
      number(persist.frameCount, "scroll survey persist frameCount");
    if (persist.full !== undefined) {
      const full = record(persist.full, "scroll survey persist full");
      string(full.png, "scroll survey persist full png");
      string(full.json, "scroll survey persist full json");
    }
  }
});

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
      if (value.serial !== undefined) string(value.serial, "target serial");
      if (value.laneId !== undefined) string(value.laneId, "target screenshot laneId");
      if (!value.serial && !value.laneId) {
        fail("target screenshot", "serial or laneId is required");
      }
      if (value.caption !== undefined) string(value.caption, "screenshot caption");
      if (value.jobId !== undefined) string(value.jobId, "screenshot jobId");
      optionalQueryBoolean(value.ephemeral, "screenshot ephemeral");
    },
  );

  const targetSnapshotInputParser = objectParser<OperationInput<"target.snapshot.capture">>(
    "target snapshot input",
    (value) => {
      if (value.serial !== undefined) string(value.serial, "target serial");
      if (value.laneId !== undefined) string(value.laneId, "target snapshot laneId");
      if (!value.serial && !value.laneId) {
        fail("target snapshot", "serial or laneId is required");
      }
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
        assertIosSessionOperationLifecycle(
          value.iosSessionLifecycle,
          "snapshot iOS session lifecycle",
        );
      }
    },
  );

  return {
    targetObservationOperationDefinition: createTargetObservationOperationDefinition(input),
    screenshotParser,
    targetScrollSurveyInputParser,
    targetScrollSurveyOutputParser,
    targetSnapshotOutputParser,
    targetScreenshotInputParser,
    targetSnapshotInputParser,
  };
}
