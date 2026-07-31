import type { JourneyMetadata, JourneyReviewState, JourneyTake } from "@relay/protocol";
import type { RecordingTake } from "../context/recorder";

export const EMPTY_JOURNEY_METADATA: JourneyMetadata = {
  schemaVersion: 6,
  positions: {},
  edgeLabels: {},
  edgeKinds: {},
  notes: [],
  takes: [],
  review: { state: "draft", updatedAt: 0 },
  graph: { schemaVersion: 1, screens: [], transitions: [], flows: [] },
};

/** Take persistence is one immutable metadata update. Keeping the review
 * state beside its captured steps prevents a late save from reopening a take
 * that was already added to the graph. */
export function metadataWithTake(
  metadata: JourneyMetadata,
  take: RecordingTake,
  state: JourneyTake["state"],
  reviewState?: JourneyReviewState,
): JourneyMetadata {
  if (!take.recipeId) return metadata;
  const nextTake: JourneyTake = {
    id: take.id,
    recipeId: take.recipeId,
    ...(take.sourceScreenId ? { sourceScreenId: take.sourceScreenId } : {}),
    startedAt: take.startedAt,
    ...(take.finishedAt ? { finishedAt: take.finishedAt } : {}),
    group: take.group,
    state,
    steps: structuredClone(take.steps),
    ...(take.videoTakeId ? { videoTakeId: take.videoTakeId } : {}),
    ...(take.videoClip ? { videoClip: { ...take.videoClip } } : {}),
  };
  const previous = metadata.takes ?? [];
  const existing = previous.find((entry) => entry.id === nextTake.id);
  if (!reviewState && existing && JSON.stringify(existing) === JSON.stringify(nextTake))
    return metadata;
  const at = Date.now();
  return {
    ...metadata,
    schemaVersion: metadata.graph ? 6 : (metadata.schemaVersion ?? 5),
    takes: [...previous.filter((entry) => entry.id !== nextTake.id), nextTake].slice(-50),
    ...(reviewState
      ? {
          review: {
            state: reviewState,
            updatedAt: at,
            ...(reviewState === "approved" ? { approvedAt: at } : {}),
          },
        }
      : {}),
  };
}
