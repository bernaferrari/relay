import type {
  AuthoringObservation,
  AuthoringTakeRevision,
  OperationInput,
  TargetProfile,
} from "@relay/protocol";
import { HttpError } from "./http.js";

type TeachInput = Omit<OperationInput<"app-map.teach">, "appMapId">;

/** Handoffs must be semantic and reversible so replay can fail closed. */
export function assertValidTeachHandoff(body: TeachInput): void {
  if (!body.handoff) return;
  if (!body.interaction || body.interaction.kind === "point" || body.interaction.kind === "swipe") {
    throw new HttpError(400, "A handoff requires a semantic label or identifier interaction");
  }
  if (!body.fromScreenId?.trim() || !body.title?.trim()) {
    throw new HttpError(400, "A handoff requires fromScreenId and a destination title");
  }
}

/** Verify both declared and undeclared application transitions after capture. */
export function assertTeachHandoffDestination(
  body: TeachInput,
  take: AuthoringTakeRevision,
  destination: NonNullable<AuthoringTakeRevision["before"]>,
): void {
  const sourceApp = take.before?.foregroundApp;
  const destinationApp = destination.foregroundApp;
  if (body.handoff) {
    if (!destinationApp || destinationApp !== body.handoff.expectedApp) {
      throw new HttpError(
        409,
        `The interaction opened ${destinationApp ?? "an unknown application"}, not ${body.handoff.expectedApp}`,
        { code: "unexpected-handoff" },
      );
    }
    return;
  }
  if (sourceApp && destinationApp && sourceApp !== destinationApp) {
    throw new HttpError(409, `The interaction left ${sourceApp} and opened ${destinationApp}`, {
      code: "undeclared-handoff",
      recovery:
        "Retry with an explicit handoff expectedApp and reversible returnAction if this transition is intentional.",
    });
  }
}

export function buildTeachScreenCapture(
  body: TeachInput,
  profile: TargetProfile,
  observation: AuthoringObservation,
  take: AuthoringTakeRevision,
) {
  return {
    target: body.target,
    targetProfile: profile,
    observation,
    evidenceUrisById: Object.fromEntries(take.evidence.map((item) => [item.id, item.uri])),
    evidenceKindsById: Object.fromEntries(take.evidence.map((item) => [item.id, item.kind])),
    evidenceById: Object.fromEntries(take.evidence.map((item) => [item.id, item])),
    ...(body.title?.trim() ? { title: body.title.trim() } : {}),
    ...(body.handoff
      ? {
          handoff: {
            ownerApp: body.handoff.expectedApp,
            returnAction: body.handoff.returnAction,
          },
        }
      : {}),
  };
}
