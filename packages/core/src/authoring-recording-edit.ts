import type {
  AuthoringAction,
  AuthoringRecordingEdit,
  AuthoringTakeRevision,
} from "@relay/protocol";
import { actionSource, stepsForInteraction } from "./authoring-action-steps.js";
import { AuthoringStateError } from "./authoring-session-state.js";
import { invalidateAuthoringActionProof } from "./authoring-transition-proof.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Pure implementation behind the canonical recording-edit seam. It returns
 * a draft revision; the Authoring Session store assigns immutable revision
 * identity, authorship, and time in its serialized mutation queue. */
export function editAuthoringTakeRevision(input: {
  revision: AuthoringTakeRevision;
  edit: AuthoringRecordingEdit;
  group?: string;
}): AuthoringTakeRevision {
  const { revision, edit } = input;
  const byId = new Map(revision.actions.map((action) => [action.id, action]));
  const requireActions = (actionIds: readonly string[], minimum: number): AuthoringAction[] => {
    if (actionIds.length < minimum || new Set(actionIds).size !== actionIds.length) {
      throw new AuthoringStateError(
        minimum > 1
          ? `Recording edit requires at least ${minimum} distinct actions`
          : "Recording edit requires distinct actions",
      );
    }
    const actions = actionIds.map((actionId) => byId.get(actionId));
    if (actions.some((action) => !action)) {
      throw new AuthoringStateError("Recording edit references an action outside this Take");
    }
    return actions as AuthoringAction[];
  };

  if (edit.kind === "clip") {
    const start = revision.before?.capturedAt ?? revision.createdAt;
    return {
      ...revision,
      actions: revision.actions.map(invalidateAuthoringActionProof),
      videoClip: {
        startMs: edit.fromMs ?? revision.videoClip?.startMs ?? 0,
        endMs:
          edit.toMs ??
          revision.videoClip?.endMs ??
          Math.max(0, (revision.after?.capturedAt ?? start) - start),
      },
    };
  }
  if (edit.kind === "remove") {
    requireActions(edit.actionIds, 1);
    const removed = new Set(edit.actionIds);
    const actions = revision.actions.filter((action) => !removed.has(action.id));
    if (!actions.length) {
      throw new AuthoringStateError("A reviewed Test must retain at least one action");
    }
    return { ...revision, actions: actions.map(invalidateAuthoringActionProof) };
  }
  if (edit.kind === "reorder") {
    const ordered = requireActions(edit.actionIds, 1);
    if (ordered.length !== revision.actions.length) {
      throw new AuthoringStateError("Reorder must contain every action exactly once");
    }
    return {
      ...revision,
      actions: ordered.map((action) => invalidateAuthoringActionProof(clone(action))),
    };
  }
  if (edit.kind === "replace") {
    requireActions([edit.actionId], 1);
    return {
      ...revision,
      actions: revision.actions.map((action) => {
        const invalidated = invalidateAuthoringActionProof(action);
        if (action.id !== edit.actionId) return invalidated;
        return {
          ...invalidated,
          source: actionSource(edit.interaction),
          steps: stepsForInteraction(edit.interaction, action.id, input.group),
          label: undefined,
          ...((edit.interaction.kind === "observe" ||
            edit.interaction.kind === "screenshot" ||
            edit.interaction.kind === "steps") &&
          edit.interaction.label
            ? { label: edit.interaction.label }
            : {}),
        };
      }),
    };
  }
  if (edit.kind === "rename") {
    requireActions([edit.actionId], 1);
    const intent = edit.intent.trim();
    if (!intent) throw new AuthoringStateError("A semantic action name is required");
    return {
      ...revision,
      actions: revision.actions.map((action) =>
        action.id === edit.actionId ? { ...action, label: intent } : action,
      ),
    };
  }
  if (edit.kind === "merge") {
    const selected = requireActions(edit.actionIds, 2);
    const indexes = selected.map((action) =>
      revision.actions.findIndex((candidate) => candidate.id === action.id),
    );
    if (indexes.some((index, offset) => index !== indexes[0]! + offset)) {
      throw new AuthoringStateError(
        "Only consecutive actions in their current order can be merged",
      );
    }
    const first = selected[0]!;
    const label =
      edit.intent?.trim() ||
      selected
        .map((action) => action.label?.trim())
        .filter((value): value is string => Boolean(value))
        .join(" · ") ||
      `${selected.length} recorded actions`;
    const merged = invalidateAuthoringActionProof({
      id: first.id,
      source: "manual",
      recordedAt: first.recordedAt,
      startedAt: first.startedAt,
      finishedAt: selected.at(-1)!.finishedAt,
      steps: selected.flatMap((action) => clone(action.steps)),
      evidenceIds: [...new Set(selected.flatMap((action) => action.evidenceIds))],
      label,
    });
    const selectedIds = new Set(edit.actionIds);
    return {
      ...revision,
      actions: revision.actions
        .flatMap((action) =>
          action.id === first.id ? [merged] : selectedIds.has(action.id) ? [] : [action],
        )
        .map(invalidateAuthoringActionProof),
    };
  }

  const action = requireActions([edit.actionId], 1)[0]!;
  if (edit.atStep >= action.steps.length) {
    throw new AuthoringStateError(
      "Split position must fall between two existing steps in the action",
    );
  }
  const elapsed = Math.max(0, action.finishedAt - action.startedAt);
  const splitAt = action.startedAt + Math.round((elapsed * edit.atStep) / action.steps.length);
  const first = invalidateAuthoringActionProof({
    ...action,
    steps: clone(action.steps.slice(0, edit.atStep)),
    finishedAt: splitAt,
  });
  const second = invalidateAuthoringActionProof({
    ...action,
    id: `${action.id}-split-${revision.revision + 1}`,
    source: "manual",
    recordedAt: splitAt,
    startedAt: splitAt,
    steps: clone(action.steps.slice(edit.atStep)),
    label: undefined,
  });
  return {
    ...revision,
    actions: revision.actions
      .flatMap((candidate) => (candidate.id === action.id ? [first, second] : [candidate]))
      .map(invalidateAuthoringActionProof),
  };
}
