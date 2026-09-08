import type { AuthoringSession } from "@relay/protocol";
import { captureScrollableSurveyForTarget } from "./scrollable-survey.js";
import { persistAuthoringEvidence } from "./authoring-evidence.js";

/** Full-page evidence belongs to the recorded action, while its exit observation
 * remains the restored viewport. Never use a stitched document as device geometry. */
export async function captureAuthoringFullPage(session: AuthoringSession) {
  if (session.target.kind !== "device") {
    throw new Error("Full-page capture currently requires an Android or iOS device.");
  }
  const survey = await captureScrollableSurveyForTarget({
    serial: session.target.targetId,
    maxScrolls: 12,
    restore: true,
  });
  const capturedAt = Date.now();
  const evidence = [];
  if (survey.stitched) {
    evidence.push(
      await persistAuthoringEvidence({
        kind: "screenshot",
        capturedAt,
        data: Buffer.from(survey.stitched.base64, "base64"),
        mime: "image/png",
      }),
    );
  }
  for (const frame of [...survey.frames, ...survey.diagnosticFrames]) {
    evidence.push(
      await persistAuthoringEvidence({
        kind: "screenshot",
        capturedAt: frame.screenshot.capturedAt,
        data: Buffer.from(frame.screenshot.base64, "base64"),
        mime: "image/png",
      }),
    );
  }
  evidence.push(
    await persistAuthoringEvidence({
      kind: "snapshot",
      capturedAt,
      mime: "application/json",
      data: JSON.stringify({
        schemaVersion: 1,
        kind: "full-page-capture",
        status: survey.status,
        reason: survey.reason,
        message: survey.message,
        restoredStartViewport: survey.restoredStartViewport,
        documentOriginProven: survey.documentOriginProven === true,
        frames: survey.frames.map(({ index, offsetY, snapshot }) => ({ index, offsetY, snapshot })),
        mergedNodes: survey.mergedNodes,
        ...(survey.stitched
          ? { bounds: { width: survey.stitched.width, height: survey.stitched.height } }
          : {}),
      }),
    }),
  );
  return {
    evidence,
    label: survey.status === "completed" ? "Capture full page" : "Capture page · partial",
  };
}
