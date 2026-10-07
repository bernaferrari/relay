import type { ActionSpec, RecordedEntrance } from "@relay/protocol";
import type { AppMapRecordingInput } from "./recording-operations.js";
import {
  currentSelectorEntrance,
  recordedStepDigest,
  requestedNativeTap,
} from "../recorded-entrance-proof.js";

/** Preserve the immutable action entrance, independently of latest Screen Variants. */
export function recordedActions(input: AppMapRecordingInput): ActionSpec[] {
  const steps = input.actions.flatMap((action) =>
    action.steps.map((original) => {
      const step = structuredClone(original);
      const request = requestedNativeTap(step);
      if (!request || (action.entranceCaptureVersion !== 1 && input.entranceCaptureVersion !== 1))
        return step;
      const identity = {
        schemaVersion: 1 as const,
        takeId: input.takeId,
        takeRevision: input.takeRevision,
        actionId: action.id,
        stepDigest: recordedStepDigest(step),
      };
      let entrance: RecordedEntrance = { ...identity, status: "unavailable" };
      const observation = input.observations?.find(
        (item) => item.id === action.entranceObservationId,
      );
      const exit = input.observations?.find((item) => item.id === action.exitObservationId);
      const reference = observation?.evidenceIds
        .map((id) => input.evidenceById?.[id])
        .find((item) => item?.kind === "snapshot");
      if (
        action.steps.length === 1 &&
        input.target.platform === "ios" &&
        input.originApplication &&
        observation &&
        exit &&
        reference &&
        typeof reference.sha256 === "string" &&
        typeof reference.bytes === "number" &&
        reference.bytes > 0 &&
        reference.mime === "application/json" &&
        action.entranceStepDigest === recordedStepDigest(step) &&
        typeof action.entranceCaptureRevision === "number" &&
        Number.isSafeInteger(action.entranceCaptureRevision) &&
        action.entranceCaptureRevision > 0 &&
        action.entranceCaptureRevision <= input.takeRevision &&
        currentSelectorEntrance(
          observation,
          input.target.targetId,
          input.originApplication,
          request,
        ) &&
        action.startedAt <= observation.proof!.pixels.capturedAt! &&
        observation.capturedAt <= action.finishedAt &&
        exit.capturedAt >= observation.capturedAt
      ) {
        entrance = {
          ...identity,
          status: "captured",
          scope: "requested-selector-catalog",
          observationId: observation.id,
          targetId: input.target.targetId,
          profile: structuredClone(observation.capture!.selectorEntrance!.profile),
          originApplication: observation.capture!.treeApp!,
          actionStartedAt: action.startedAt,
          actionFinishedAt: action.finishedAt,
          capturedAt: observation.capturedAt,
          request,
          rawTree: {
            id: reference.id,
            uri: reference.uri,
            sha256: reference.sha256,
            mime: "application/json",
            bytes: reference.bytes,
          },
        };
      }
      return { ...step, recordedEntrance: entrance };
    }),
  );
  return steps.length
    ? [
        {
          id: `recording-${input.takeId}`,
          kind: "recorded",
          takeId: input.takeId,
          takeRevision: input.takeRevision,
          ...(input.entranceCaptureVersion === 1 ? { entranceCaptureVersion: 1 as const } : {}),
          steps,
          evidenceIds: [...new Set(input.evidenceIds)],
        },
      ]
    : [{ id: `passive-${input.takeId}`, kind: "passive", reason: "observe-only" }];
}
