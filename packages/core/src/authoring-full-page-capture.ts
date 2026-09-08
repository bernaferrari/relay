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
  let stitchedEvidenceId: string | undefined;
  if (survey.stitched) {
    const stitchedEvidence = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt,
      data: Buffer.from(survey.stitched.base64, "base64"),
      mime: "image/png",
    });
    evidence.push(stitchedEvidence);
    stitchedEvidenceId = stitchedEvidence.id;
  }
  const frameEvidence = [];
  for (const frame of survey.frames) {
    const item = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt: frame.screenshot.capturedAt,
      data: Buffer.from(frame.screenshot.base64, "base64"),
      mime: "image/png",
    });
    evidence.push(item);
    frameEvidence.push({ index: frame.index, offsetY: frame.offsetY, evidenceId: item.id });
  }
  const diagnosticFrameEvidence = [];
  for (const frame of survey.diagnosticFrames) {
    const item = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt: frame.screenshot.capturedAt,
      data: Buffer.from(frame.screenshot.base64, "base64"),
      mime: "image/png",
    });
    evidence.push(item);
    diagnosticFrameEvidence.push({
      index: frame.index,
      offsetY: frame.offsetY,
      evidenceId: item.id,
    });
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
    fullPage: {
      status: survey.status,
      reason: survey.reason,
      message: survey.message,
      frames: frameEvidence,
      diagnosticFrames: diagnosticFrameEvidence,
      ...(stitchedEvidenceId ? { stitchedEvidenceId } : {}),
      mergedNodes: survey.mergedNodes,
    },
  };
}
