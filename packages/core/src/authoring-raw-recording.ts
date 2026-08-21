import { randomUUID } from "node:crypto";
import {
  AUTHORING_RAW_CAPTURE_VERSION,
  type AuthoringAction,
  type AuthoringInteraction,
  type AuthoringObservation,
  type AuthoringRawCaptureVersion,
  type AuthoringRawEvent,
  type AuthoringRawInteraction,
  type AuthoringRawInteractionEvent,
  type AuthoringRawInteractionIntentEvent,
  type AuthoringRawInteractionOutcomeEvent,
  type AuthoringRawObservationEvent,
  type AuthoringRawObservationLink,
  type AuthoringRawOptimizationProposal,
  type AuthoringRawTakeStartEvent,
  type AuthoringRawTakeStopEvent,
  type AuthoringRawTargetMetadata,
  type AuthoringTake,
  type AuthoringTarget,
  type StepTarget,
} from "@relay/protocol";

type RawEventInput =
  | Omit<AuthoringRawTakeStartEvent, "id" | "sequence" | "source">
  | Omit<AuthoringRawObservationEvent, "id" | "sequence" | "source">
  | Omit<AuthoringRawInteractionEvent, "id" | "sequence" | "source">
  | Omit<AuthoringRawInteractionIntentEvent, "id" | "sequence" | "source">
  | Omit<AuthoringRawInteractionOutcomeEvent, "id" | "sequence" | "source">
  | Omit<AuthoringRawTakeStopEvent, "id" | "sequence" | "source">;

export type AuthoringRawRecordingPatch = {
  rawCaptureVersion: AuthoringRawCaptureVersion;
  rawEvents: AuthoringRawEvent[];
};

export type AuthoringRawInteractionIntentPatch = AuthoringRawRecordingPatch & {
  /** The immutable source event id that every terminal outcome must reference. */
  intentEventId: string;
};

type ExistingRawCapture = {
  version: AuthoringRawCaptureVersion;
  events: AuthoringRawEvent[];
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function rawTarget(target: StepTarget | undefined): AuthoringRawTargetMetadata | undefined {
  if (!target) return undefined;
  const strategies: AuthoringRawTargetMetadata["strategies"] = [];
  if (target.identifier) strategies.push("identifier");
  if (target.ref) strategies.push("ref");
  if (target.label) strategies.push("label");
  if (target.text) strategies.push("text");
  if (target.relation) strategies.push("relation");
  if (target.point) strategies.push("point");
  if (strategies.length === 0) return undefined;
  const point = target.point;
  return {
    strategies,
    ...(point
      ? {
          point: {
            x: point.x,
            y: point.y,
            ...(point.referenceBounds ? { referenceBounds: { ...point.referenceBounds } } : {}),
            ...(point.anchor ? { anchored: true } : {}),
            ...(point.relativeTo ? { relative: true } : {}),
          },
        }
      : {}),
  };
}

/** Summarize a private value without retaining text, a hash, or any other
 * value-specific token. The summary is intentionally small enough for safe
 * local telemetry and offline optimizer review. */
function hasNonAsciiCodePoint(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return true;
  }
  return false;
}

export function redactAuthoringRawValue(value: string) {
  return {
    redacted: true as const,
    length: Array.from(value).length,
    lineCount: value === "" ? 0 : value.split(/\r\n|\r|\n/u).length,
    hasNonAscii: hasNonAsciiCodePoint(value),
  };
}

/** Convert a mutable authoring command into a privacy-safe historical fact.
 * Do not add raw labels, identifiers, URLs, recipes, bindings, or values here:
 * their reviewed representation already belongs to the editable action. */
export function redactAuthoringRawInteraction(
  interaction: AuthoringInteraction,
): AuthoringRawInteraction {
  const applied =
    "applied" in interaction && interaction.applied !== undefined
      ? { applied: interaction.applied }
      : {};
  switch (interaction.kind) {
    case "tap":
      return {
        kind: "tap",
        ...(interaction.target ? { target: rawTarget(interaction.target) } : {}),
        ...(interaction.expectedApp ? { hasExpectedApp: true } : {}),
        ...applied,
      };
    case "type":
      return {
        kind: "type",
        ...(interaction.target ? { target: rawTarget(interaction.target) } : {}),
        ...(interaction.mode ? { mode: interaction.mode } : {}),
        value: redactAuthoringRawValue(interaction.text),
        ...applied,
      };
    case "clipboard":
      return {
        kind: "clipboard",
        action: interaction.action,
        ...(interaction.target ? { target: rawTarget(interaction.target) } : {}),
        ...(interaction.text !== undefined
          ? { value: redactAuthoringRawValue(interaction.text) }
          : {}),
        ...(interaction.expect !== undefined
          ? { expectation: redactAuthoringRawValue(interaction.expect) }
          : {}),
        ...(interaction.match ? { match: interaction.match } : {}),
        ...applied,
      };
    case "app":
      return {
        kind: "app",
        action: interaction.action,
        ...(interaction.app ? { hasApp: true } : {}),
        ...(interaction.url ? { hasUrl: true } : {}),
        ...(interaction.artifact ? { hasArtifact: true } : {}),
        ...(interaction.version ? { hasVersion: true } : {}),
        ...(interaction.relaunch !== undefined ? { relaunch: interaction.relaunch } : {}),
        ...applied,
      };
    case "device":
      return { kind: "device", action: interaction.action, ...applied };
    case "rotate":
      return { kind: "rotate", orientation: interaction.orientation, ...applied };
    case "swipe":
      return {
        kind: "swipe",
        from: { ...interaction.from },
        to: { ...interaction.to },
        ...(interaction.durationMs !== undefined ? { durationMs: interaction.durationMs } : {}),
        ...applied,
      };
    case "key":
      return { kind: "key", key: interaction.key, ...applied };
    case "wait":
      return { kind: "wait", ms: interaction.ms };
    case "observe":
      return { kind: "observe", ...(interaction.label ? { hasLabel: true } : {}) };
    case "screenshot":
      return { kind: "screenshot", ...(interaction.label ? { hasLabel: true } : {}) };
    case "reusable":
      return {
        kind: "reusable",
        ...(interaction.recipeId ? { hasRecipe: true } : {}),
        bindingCount: Object.keys(interaction.bindings ?? {}).length,
      };
    case "steps":
      return {
        kind: "steps",
        stepCount: interaction.steps.length,
        ...(interaction.label ? { hasLabel: true } : {}),
        ...applied,
      };
  }
}

/** Reduce a captured screen to immutable linkage. Screenshots, trees, and
 * focus payloads stay in their evidence files; the raw stream only tells a
 * later reviewer exactly which durable evidence to load. */
export function rawObservationLink(
  observation: AuthoringObservation,
  focus?: AuthoringRawObservationLink["focus"],
): AuthoringRawObservationLink {
  return {
    observationId: observation.id,
    capturedAt: observation.capturedAt,
    evidenceIds: unique(observation.evidenceIds),
    ...(observation.bounds ? { viewport: { ...observation.bounds } } : {}),
    ...(focus ? { focus: structuredClone(focus) } : {}),
  };
}

function assertExistingRawCapture(
  take: Pick<AuthoringTake, "rawCaptureVersion" | "rawEvents">,
): ExistingRawCapture | undefined {
  if (take.rawEvents === undefined) {
    if (take.rawCaptureVersion !== undefined) {
      throw new Error("Raw authoring capture version exists without raw events");
    }
    return undefined;
  }
  if (take.rawCaptureVersion !== 1 && take.rawCaptureVersion !== AUTHORING_RAW_CAPTURE_VERSION) {
    throw new Error(`Unsupported raw authoring capture version ${String(take.rawCaptureVersion)}`);
  }
  const ids = new Set<string>();
  for (const [index, event] of take.rawEvents.entries()) {
    if (event.sequence !== index + 1 || !event.id || ids.has(event.id)) {
      throw new Error("Raw authoring events must have unique contiguous append order");
    }
    ids.add(event.id);
  }
  const terminalIntentIds = new Set<string>();
  for (const event of take.rawEvents) {
    if (event.kind !== "interaction-outcome") continue;
    if (!ids.has(event.intentEventId)) {
      throw new Error("Raw authoring interaction outcome has no matching intent");
    }
    const intent = take.rawEvents.find((candidate) => candidate.id === event.intentEventId);
    if (!intent || intent.kind !== "interaction-intent" || intent.sequence >= event.sequence) {
      throw new Error("Raw authoring interaction outcome must follow its intent");
    }
    if (terminalIntentIds.has(event.intentEventId)) {
      throw new Error("Raw authoring interaction intent has more than one terminal outcome");
    }
    terminalIntentIds.add(event.intentEventId);
  }
  return { version: take.rawCaptureVersion, events: structuredClone(take.rawEvents) };
}

function appendRawEvent(
  events: readonly AuthoringRawEvent[],
  target: AuthoringTarget,
  input: RawEventInput,
  rawCaptureVersion: AuthoringRawCaptureVersion = AUTHORING_RAW_CAPTURE_VERSION,
): AuthoringRawRecordingPatch {
  const event = {
    ...structuredClone(input),
    id: `raw-${randomUUID()}`,
    sequence: events.length + 1,
    source: { kind: "authoring-runtime" as const, target: structuredClone(target) },
  } as AuthoringRawEvent;
  return {
    rawCaptureVersion,
    rawEvents: [...structuredClone(events), event],
  };
}

/** Start a new source record. This is the only way a Take gains raw capture;
 * a legacy Take is never retroactively populated from editable revisions. */
export function seedAuthoringRawRecording(input: {
  target: AuthoringTarget;
  trigger: "recording" | "capture";
  recordedAt: number;
  observation: AuthoringObservation;
  focus?: AuthoringRawObservationLink["focus"];
}): AuthoringRawRecordingPatch {
  return appendRawEvent([], input.target, {
    kind: "take-start",
    trigger: input.trigger,
    recordedAt: input.recordedAt,
    observation: rawObservationLink(input.observation, input.focus),
  });
}

/** Append a manual observation only when the Take already has a raw source
 * record. Returning undefined preserves sessions saved by older Relay builds. */
export function appendAuthoringRawObservation(
  take: Pick<AuthoringTake, "rawCaptureVersion" | "rawEvents">,
  input: {
    target: AuthoringTarget;
    recordedAt: number;
    observation: AuthoringObservation;
    focus?: AuthoringRawObservationLink["focus"];
  },
): AuthoringRawRecordingPatch | undefined {
  const capture = assertExistingRawCapture(take);
  if (!capture) return undefined;
  return appendRawEvent(
    capture.events,
    input.target,
    {
      kind: "observation",
      recordedAt: input.recordedAt,
      observation: rawObservationLink(input.observation, input.focus),
    },
    capture.version,
  );
}

/** Compatibility writer for version 1 completed command facts. New version 2
 * recordings use appendAuthoringRawInteractionIntent plus a terminal outcome
 * so an interrupted native command is never silently lost. */
export function appendAuthoringRawInteraction(
  take: Pick<AuthoringTake, "rawCaptureVersion" | "rawEvents">,
  input: {
    target: AuthoringTarget;
    interaction: AuthoringInteraction;
    action: AuthoringAction;
    entrance?: AuthoringObservation;
    exit?: AuthoringObservation;
  },
): AuthoringRawRecordingPatch | undefined {
  const capture = assertExistingRawCapture(take);
  if (!capture || capture.version !== 1) return undefined;
  return appendRawEvent(
    capture.events,
    input.target,
    {
      kind: "interaction",
      recordedAt: input.action.recordedAt,
      startedAt: input.action.startedAt,
      finishedAt: input.action.finishedAt,
      interaction: redactAuthoringRawInteraction(input.interaction),
      links: {
        actionId: input.action.id,
        ...(input.entrance ? { entranceObservationId: input.entrance.id } : {}),
        ...(input.exit ? { exitObservationId: input.exit.id } : {}),
        evidenceIds: unique(input.action.evidenceIds),
      },
    },
    capture.version,
  );
}

/** Durably append an interaction intent before Relay invokes its native
 * adapter. Version 1 streams intentionally remain untouched: they keep their
 * original completed-event representation instead of being schema-upgraded
 * in place during a resumed recording. */
export function appendAuthoringRawInteractionIntent(
  take: Pick<AuthoringTake, "rawCaptureVersion" | "rawEvents">,
  input: {
    target: AuthoringTarget;
    interaction: AuthoringInteraction;
    startedAt: number;
    entrance?: AuthoringObservation;
  },
): AuthoringRawInteractionIntentPatch | undefined {
  const capture = assertExistingRawCapture(take);
  if (!capture || capture.version !== AUTHORING_RAW_CAPTURE_VERSION) return undefined;
  const patch = appendRawEvent(
    capture.events,
    input.target,
    {
      kind: "interaction-intent",
      recordedAt: input.startedAt,
      startedAt: input.startedAt,
      interaction: redactAuthoringRawInteraction(input.interaction),
      links: {
        ...(input.entrance ? { entranceObservationId: input.entrance.id } : {}),
        evidenceIds: unique(input.entrance?.evidenceIds ?? []),
      },
    },
    capture.version,
  );
  const intent = patch.rawEvents.at(-1);
  if (!intent || intent.kind !== "interaction-intent") {
    throw new Error("Raw authoring interaction intent was not appended");
  }
  return { ...patch, intentEventId: intent.id };
}

/** Append exactly one terminal fact for a durable intent. Failure details are
 * deliberately omitted because native errors can contain user-generated
 * strings; the immutable intent plus outcome is sufficient for recovery. */
export function appendAuthoringRawInteractionOutcome(
  take: Pick<AuthoringTake, "rawCaptureVersion" | "rawEvents">,
  input: {
    target: AuthoringTarget;
    intentEventId: string;
    outcome: "succeeded" | "failed" | "unknown";
    finishedAt: number;
    action?: AuthoringAction;
    exit?: AuthoringObservation;
  },
): AuthoringRawRecordingPatch | undefined {
  const capture = assertExistingRawCapture(take);
  if (!capture || capture.version !== AUTHORING_RAW_CAPTURE_VERSION) return undefined;
  const intent = capture.events.find(
    (event): event is AuthoringRawInteractionIntentEvent =>
      event.kind === "interaction-intent" && event.id === input.intentEventId,
  );
  if (!intent) throw new Error("Raw authoring interaction outcome has no matching intent");
  if (
    capture.events.some(
      (event) =>
        event.kind === "interaction-outcome" && event.intentEventId === input.intentEventId,
    )
  ) {
    throw new Error("Raw authoring interaction intent already has a terminal outcome");
  }
  return appendRawEvent(
    capture.events,
    input.target,
    {
      kind: "interaction-outcome",
      recordedAt: input.finishedAt,
      intentEventId: input.intentEventId,
      outcome: input.outcome,
      finishedAt: input.finishedAt,
      links: {
        ...(input.action ? { actionId: input.action.id } : {}),
        ...(input.exit ? { exitObservationId: input.exit.id } : {}),
        evidenceIds: unique(input.action?.evidenceIds ?? []),
      },
    },
    capture.version,
  );
}

/** Return unresolved native-command intents without changing their source
 * history. Recovery callers can show this bounded, redacted metadata rather
 * than inferring success from an interrupted recording session. */
export function pendingAuthoringRawInteractionIntents(
  take: Pick<AuthoringTake, "rawCaptureVersion" | "rawEvents">,
): AuthoringRawInteractionIntentEvent[] | undefined {
  const capture = assertExistingRawCapture(take);
  if (!capture) return undefined;
  const completed = new Set(
    capture.events
      .filter(
        (event): event is AuthoringRawInteractionOutcomeEvent =>
          event.kind === "interaction-outcome",
      )
      .map((event) => event.intentEventId),
  );
  return capture.events.filter(
    (event): event is AuthoringRawInteractionIntentEvent =>
      event.kind === "interaction-intent" && !completed.has(event.id),
  );
}

/** Append the terminal frame after video has been sealed. This works for a
 * normal Stop and a reconciled Cancel but never invents raw history for an
 * old Take that did not begin with a raw seed. */
export function appendAuthoringRawStop(
  take: Pick<AuthoringTake, "rawCaptureVersion" | "rawEvents">,
  input: {
    target: AuthoringTarget;
    recordedAt: number;
    observation: AuthoringObservation;
    evidenceIds: string[];
    focus?: AuthoringRawObservationLink["focus"];
  },
): AuthoringRawRecordingPatch | undefined {
  const capture = assertExistingRawCapture(take);
  if (!capture) return undefined;
  return appendRawEvent(
    capture.events,
    input.target,
    {
      kind: "take-stop",
      recordedAt: input.recordedAt,
      observation: rawObservationLink(input.observation, input.focus),
      evidenceIds: unique(input.evidenceIds),
    },
    capture.version,
  );
}

/** Produce only review work. This function is deterministic, has no I/O, and
 * never returns a replacement revision or a mutation to apply automatically. */
export function proposeAuthoringRawOptimizations(
  take: Pick<AuthoringTake, "id" | "currentRevision" | "rawCaptureVersion" | "rawEvents">,
): AuthoringRawOptimizationProposal | undefined {
  const capture = assertExistingRawCapture(take);
  if (!capture) return undefined;
  const intents = new Map(
    capture.events
      .filter(
        (event): event is AuthoringRawInteractionIntentEvent => event.kind === "interaction-intent",
      )
      .map((event) => [event.id, event]),
  );
  const completed = capture.events.flatMap((event) => {
    if (event.kind === "interaction") {
      return [
        { rawEventId: event.id, actionId: event.links.actionId, interaction: event.interaction },
      ];
    }
    if (event.kind !== "interaction-outcome" || event.outcome !== "succeeded") return [];
    const intent = intents.get(event.intentEventId);
    if (!intent || !event.links.actionId) return [];
    return [
      { rawEventId: intent.id, actionId: event.links.actionId, interaction: intent.interaction },
    ];
  });
  const suggestions: AuthoringRawOptimizationProposal["suggestions"] = [];
  for (const event of completed) {
    if (event.interaction.kind === "observe" || event.interaction.kind === "screenshot") {
      suggestions.push({
        kind: "review-observe-only",
        rawEventId: event.rawEventId,
        actionId: event.actionId,
        reason: "Review whether this observation-only action is needed in the replay path.",
      });
    }
    if (event.interaction.kind === "wait" && event.interaction.ms > 0) {
      suggestions.push({
        kind: "review-wait",
        rawEventId: event.rawEventId,
        actionId: event.actionId,
        reason: "Review whether this recorded wait is still required by the current target.",
      });
    }
  }
  return {
    schemaVersion: 1,
    kind: "authoring-raw-optimization",
    reviewOnly: true,
    takeId: take.id,
    captureVersion: capture.version,
    baseRevision: take.currentRevision,
    sourceEventIds: capture.events.map((event) => event.id),
    suggestions,
  };
}
