/**
 * Model-facing decision surface for plain-English `act` steps: candidates,
 * the decision schema, prompt construction, and translation of decisions into
 * ordinary recipe steps. Pure functions only — the execution loop lives in
 * recipe-runner-act.ts.
 */
import { z } from "zod";
import type { PressKeyModifier, PressKeyName, RecipeStep, StepTarget } from "@relay/protocol";
import type { SnapshotNode } from "../device/device.js";

export const MAX_CANDIDATES = 80;
export const MAX_BATCH_ACTIONS = 8;
export const MAX_WAIT_MS = 15_000;

export type ActCandidate = {
  id: string;
  label?: string;
  role?: string;
  identifier?: string;
  editable?: boolean;
  /** Center of the control in the coordinate space the model sees — the
   * screenshot's own pixel space when a geometry mapping exists, otherwise
   * the device's logical space. Present only when the node carried a rect. */
  x?: number;
  y?: number;
  target: StepTarget;
};

/** The affine mapping between the screenshot the model sees and the logical
 * coordinates actuation uses. `scale` converts logical → image pixels. */
export type ActObservationGeometry = {
  scale: number;
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

const EDITABLE_TYPES =
  /textfield|textarea|edittext|searchfield|securetextfield|input|textbox|combobox/i;

const INTERACTIVE_ROLES =
  /^(button|link|option|menuitem|menuitemradio|menuitemcheckbox|checkbox|radio|switch|tab|textbox|combobox|spinbutton|slider|a|select)$/i;

function nodeText(node: SnapshotNode): string {
  return (node.label ?? node.value ?? "").trim();
}

/** Interactive elements deserve candidates even when nothing labels them: an
 * icon-only button is invisible to the model only if we drop it, and the
 * screenshot plus its coordinates is exactly how a person would find it. */
function isInteractiveNode(node: SnapshotNode): boolean {
  if (node.hittable === true) return true;
  const role = `${node.role ?? node.type ?? ""}`.trim();
  return INTERACTIVE_ROLES.test(role);
}

export function actCandidates(
  nodes: SnapshotNode[],
  geometry?: ActObservationGeometry,
): ActCandidate[] {
  const out: ActCandidate[] = [];
  const seen = new Set<string>();
  const scale = geometry?.scale ?? 1;
  for (const node of nodes) {
    if (node.visibleToUser === false || node.enabled === false) continue;
    const label = nodeText(node) || node.content?.trim() || node.description?.trim() || "";
    const identifier = node.identifier?.trim() || undefined;
    const role = (node.role ?? node.type)?.trim() || undefined;
    const editable =
      node.editable === true || EDITABLE_TYPES.test(`${node.type ?? ""} ${node.role ?? ""}`);
    const interactive = isInteractiveNode(node);
    if (!label && !identifier && !editable && !interactive) continue;
    const point = node.rect
      ? {
          x: Math.round(node.rect.x + node.rect.width / 2),
          y: Math.round(node.rect.y + node.rect.height / 2),
        }
      : undefined;
    const key = `${identifier ?? ""}|${label}|${point?.x ?? ""},${point?.y ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const target: StepTarget = identifier
      ? { identifier, ...(label ? { label } : {}) }
      : label
        ? { label, ...(point ? { point } : {}) }
        : point
          ? { point }
          : {};
    out.push({
      id: `c${out.length + 1}`,
      ...(label ? { label: label.slice(0, 120) } : {}),
      ...(role ? { role } : {}),
      ...(identifier ? { identifier } : {}),
      ...(editable ? { editable } : {}),
      ...(point ? { x: Math.round(point.x * scale), y: Math.round(point.y * scale) } : {}),
      target,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

const pressKeyNames = [
  "escape",
  "tab",
  "enter",
  "backspace",
  "delete",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "home",
  "end",
  "pageup",
  "pagedown",
  "a",
  "c",
  "k",
  "v",
  "x",
  "z",
] as const;
const pressKeyModifierNames = ["control", "meta", "shift", "alt", "controlOrMeta"] as const;

const atomicActionSchema = z.object({
  action: z.enum([
    "tap",
    "type",
    "scroll",
    "back",
    "wait",
    "hover",
    "select",
    "press-key",
    "drag",
    "upload-file",
    "switch-tab",
  ]),
  candidateId: z.string().optional(),
  /** Screenshot-pixel coordinate for a visual tap/hover when no candidate
   * fits. Fallback only — semantic candidates always win. */
  point: z.object({ x: z.number(), y: z.number() }).optional(),
  text: z.string().optional(),
  submit: z.boolean().optional(),
  direction: z.enum(["down", "up", "left", "right"]).optional(),
  option: z.string().optional(),
  key: z.enum(pressKeyNames).optional(),
  modifiers: z.array(z.enum(pressKeyModifierNames)).max(3).optional(),
  ms: z.number().optional(),
  /** Drag destination: the candidate to drop onto. */
  targetCandidateId: z.string().optional(),
  /** Drag destination in screenshot pixels when no candidate describes it. */
  targetPoint: z.object({ x: z.number(), y: z.number() }).optional(),
  /** Workspace-relative file reference for upload-file. */
  file: z.string().optional(),
  /** Zero-based open-page index for switch-tab. */
  index: z.number().optional(),
  /** URL substring matching exactly one open page for switch-tab. */
  url: z.string().optional(),
});

export const actDecisionSchema = atomicActionSchema.extend({
  action: z.enum([
    "done",
    "impossible",
    "tap",
    "type",
    "scroll",
    "back",
    "wait",
    "hover",
    "select",
    "press-key",
    "drag",
    "upload-file",
    "switch-tab",
  ]),
  /** Ordered batch of actions executed within one round trip. Use only when
   * intermediate actions do not change the screen's meaning — typing across
   * a form's fields is the canonical case. */
  actions: z.array(atomicActionSchema).max(MAX_BATCH_ACTIONS).optional(),
  finishesIntent: z.boolean().optional(),
  reason: z.string(),
});

export type ActAtomicDecision =
  | { action: "tap"; candidateId?: string; point?: { x: number; y: number } }
  | { action: "hover"; candidateId?: string; point?: { x: number; y: number } }
  | { action: "type"; text: string; candidateId?: string; submit?: boolean }
  | { action: "scroll"; direction?: "down" | "up" | "left" | "right" }
  | { action: "back" }
  | { action: "wait"; ms?: number }
  | { action: "select"; candidateId: string; option: string }
  | { action: "press-key"; key: PressKeyName; modifiers?: PressKeyModifier[] }
  | {
      action: "drag";
      candidateId?: string;
      point?: { x: number; y: number };
      targetCandidateId?: string;
      targetPoint?: { x: number; y: number };
    }
  | { action: "upload-file"; file: string; candidateId?: string }
  | { action: "switch-tab"; index?: number; url?: string };

export type ActDecision =
  | { action: "done"; reason: string }
  | { action: "impossible"; reason: string }
  | ({ reason: string; finishesIntent?: boolean } & ActAtomicDecision)
  | {
      action: "batch";
      actions: ActAtomicDecision[];
      reason: string;
      finishesIntent?: boolean;
    };

export function normalizeAtomicDecision(
  raw: Omit<z.infer<typeof atomicActionSchema>, "action"> & {
    action: z.infer<typeof atomicActionSchema>["action"];
  },
): ActAtomicDecision | undefined {
  switch (raw.action) {
    case "tap":
      if (!raw.candidateId && !raw.point) return undefined;
      return {
        action: "tap",
        ...(raw.candidateId ? { candidateId: raw.candidateId } : {}),
        ...(raw.point ? { point: raw.point } : {}),
      };
    case "hover":
      if (!raw.candidateId && !raw.point) return undefined;
      return {
        action: "hover",
        ...(raw.candidateId ? { candidateId: raw.candidateId } : {}),
        ...(raw.point ? { point: raw.point } : {}),
      };
    case "type":
      if (raw.text === undefined) return undefined;
      return {
        action: "type",
        text: raw.text,
        ...(raw.candidateId ? { candidateId: raw.candidateId } : {}),
        ...(raw.submit ? { submit: true } : {}),
      };
    case "scroll":
      return { action: "scroll", direction: raw.direction ?? "down" };
    case "back":
      return { action: "back" };
    case "wait":
      return {
        action: "wait",
        ...(raw.ms !== undefined
          ? { ms: Math.max(100, Math.min(MAX_WAIT_MS, Math.round(raw.ms))) }
          : {}),
      };
    case "select":
      if (!raw.candidateId || !raw.option) return undefined;
      return { action: "select", candidateId: raw.candidateId, option: raw.option };
    case "press-key":
      if (!raw.key) return undefined;
      return {
        action: "press-key",
        key: raw.key,
        ...(raw.modifiers?.length ? { modifiers: raw.modifiers } : {}),
      };
    case "drag": {
      const hasSource = Boolean(raw.candidateId || raw.point);
      const hasDestination = Boolean(raw.targetCandidateId || raw.targetPoint);
      if (!hasSource || !hasDestination) return undefined;
      return {
        action: "drag",
        ...(raw.candidateId ? { candidateId: raw.candidateId } : {}),
        ...(raw.point ? { point: raw.point } : {}),
        ...(raw.targetCandidateId ? { targetCandidateId: raw.targetCandidateId } : {}),
        ...(raw.targetPoint ? { targetPoint: raw.targetPoint } : {}),
      };
    }
    case "upload-file":
      if (!raw.file?.trim()) return undefined;
      return {
        action: "upload-file",
        file: raw.file.trim(),
        ...(raw.candidateId ? { candidateId: raw.candidateId } : {}),
      };
    case "switch-tab": {
      const index = raw.index;
      const url = raw.url?.trim();
      if ((index === undefined) === !url) return undefined;
      if (index !== undefined && (!Number.isInteger(index) || index < 0)) return undefined;
      return {
        action: "switch-tab",
        ...(index !== undefined ? { index } : {}),
        ...(url ? { url } : {}),
      };
    }
    default:
      return undefined;
  }
}

export function normalizeActDecision(raw: unknown): ActDecision {
  const parsed = actDecisionSchema.safeParse(raw);
  if (!parsed.success)
    return { action: "impossible", reason: "The model returned an invalid action." };
  const value = parsed.data;
  const reason = value.reason.trim() || value.action;
  if (value.action === "done") return { action: "done", reason };
  if (value.action === "impossible") return { action: "impossible", reason };

  // A non-empty batch is the decision; the singular fields are ignored so one
  // response can never mean two different first actions.
  const batch = (value.actions ?? [])
    .map((item) => normalizeAtomicDecision(item))
    .filter((item): item is ActAtomicDecision => item !== undefined);
  if (batch.length) {
    return {
      action: "batch",
      actions: batch.slice(0, MAX_BATCH_ACTIONS),
      reason,
      finishesIntent: value.finishesIntent,
    };
  }
  const atomic = normalizeAtomicDecision({ ...value, action: value.action });
  if (!atomic) {
    return {
      action: "impossible",
      reason: `The model chose ${value.action} without the fields it requires.`,
    };
  }
  return { ...atomic, reason, finishesIntent: value.finishesIntent };
}

export function actPrompt(input: {
  intent: string;
  candidates: ActCandidate[];
  history: string[];
  geometry?: ActObservationGeometry;
  coordinateActuation: boolean;
  extraLines?: string[];
}): string {
  const geometry = input.geometry;
  return [
    "You operate an app under test to accomplish ONE plain-English step.",
    `Step: ${JSON.stringify(input.intent)}`,
    input.history.length
      ? `Actions already taken for this step: ${JSON.stringify(input.history)}`
      : "No actions taken yet for this step.",
    ...(input.extraLines ?? []),
    ...(geometry
      ? [
          `The screenshot is ${geometry.imageWidth}x${geometry.imageHeight} pixels. Candidate x/y coordinates are in that same screenshot pixel space.`,
        ]
      : []),
    "Visible controls (choose by id):",
    JSON.stringify(input.candidates.map(({ target: _target, ...candidate }) => candidate)),
    "Reply with exactly one next action, or a batch:",
    '- "done" if the screen shows the step is already accomplished.',
    '- "impossible" if the step cannot be done from this screen (explain what you see instead).',
    '- "tap" with candidateId. Prefer candidates over coordinates.',
    '- "type" with text (and candidateId of the field when known; submit=true to press Enter).',
    '- "scroll" with direction (down, up, left, or right), "back", or "wait" (with ms) when the screen is still loading.',
    '- "hover" with candidateId to reveal hover-only menus or tooltips.',
    '- "select" with candidateId and option for a native dropdown.',
    '- "press-key" with key (and modifiers) for keyboard shortcuts like Escape, Tab, or controlOrMeta+k.',
    '- "drag" with candidateId (what to drag) and targetCandidateId (where to drop it) for reordering, drag-and-drop, or a slider.',
    '- "upload-file" with file (a workspace-relative path) and candidateId of the file input when the step attaches a file.',
    '- "switch-tab" with index (zero-based) or url (matching exactly one open page) when the step continues in another browser tab.',
    ...(input.coordinateActuation
      ? [
          '- "tap" or "hover" with point {x, y} in screenshot pixels ONLY when no candidate describes the control you need (an unlabeled icon, a canvas region). This is a last resort.',
          '- "drag" may use point and targetPoint in screenshot pixels instead of candidates under the same last-resort rule.',
        ]
      : []),
    `To batch: reply with "actions" (at most ${MAX_BATCH_ACTIONS}) instead of a single action. Batch only when intermediate actions cannot change what the screen means — typing across form fields is the canonical case. A batch item that fails cancels the rest.`,
    "Set finishesIntent=true when this action alone completes the step.",
    "Only act toward this step; never perform unrelated or destructive actions.",
  ].join("\n");
}

function pointTargetForDecision(
  point: { x: number; y: number },
  geometry: ActObservationGeometry | undefined,
): StepTarget {
  // Model coordinates arrive in screenshot pixels; actuation needs logical
  // (CSS) coordinates. The reference bounds record what the point meant.
  const scale = geometry?.scale ?? 1;
  const x = Math.round(point.x / scale);
  const y = Math.round(point.y / scale);
  return {
    point: {
      x,
      y,
      ...(geometry
        ? { referenceBounds: { width: geometry.viewportWidth, height: geometry.viewportHeight } }
        : {}),
    },
  };
}

export type ConcreteActSteps = {
  steps: RecipeStep[];
  summary: string;
  /** True when any step actuates through a visual coordinate rather than a
   * semantic candidate. */
  coordinateVisual: boolean;
};

/** Translate one atomic decision into the concrete recipe steps the engine runs. */
export function concreteStepsForAtomic(
  decision: ActAtomicDecision,
  candidates: ActCandidate[],
  geometry?: ActObservationGeometry,
): ConcreteActSteps {
  const find = (id: string | undefined) => candidates.find((candidate) => candidate.id === id);
  switch (decision.action) {
    case "tap":
    case "hover": {
      const candidate = find(decision.candidateId);
      const verb = decision.action === "tap" ? "Tap" : "Hover";
      if (!candidate && !decision.point) {
        throw new Error(`act: the model chose an unknown control (${decision.candidateId})`);
      }
      if (candidate) {
        const kind = decision.action === "tap" ? ("tap" as const) : ("hover" as const);
        return {
          steps: [{ kind, target: candidate.target } as RecipeStep],
          summary: `${verb} ${candidate.label ?? candidate.identifier ?? "control"}`,
          coordinateVisual: false,
        };
      }
      const target = pointTargetForDecision(decision.point!, geometry);
      const kind = decision.action === "tap" ? ("tap" as const) : ("hover" as const);
      return {
        steps: [{ kind, target } as RecipeStep],
        summary: `${verb} at (${decision.point!.x}, ${decision.point!.y})`,
        coordinateVisual: true,
      };
    }
    case "type": {
      const candidate = find(decision.candidateId);
      const steps: RecipeStep[] = [
        {
          kind: "type",
          text: decision.text!,
          mode: "replace",
          ...(candidate ? { target: candidate.target } : {}),
        },
      ];
      if (decision.submit) steps.push({ kind: "device", action: "keyboard-enter" });
      return {
        steps,
        summary: `Type ${JSON.stringify(decision.text)}${candidate?.label ? ` into ${candidate.label}` : ""}`,
        coordinateVisual: false,
      };
    }
    case "select": {
      const candidate = find(decision.candidateId);
      if (!candidate) {
        throw new Error(`act: the model chose an unknown control (${decision.candidateId})`);
      }
      return {
        steps: [{ kind: "select", target: candidate.target, option: decision.option! }],
        summary: `Select ${JSON.stringify(decision.option)} in ${candidate.label ?? candidate.identifier ?? "control"}`,
        coordinateVisual: false,
      };
    }
    case "press-key":
      return {
        steps: [
          {
            kind: "press-key",
            key: decision.key!,
            ...(decision.modifiers?.length ? { modifiers: [...decision.modifiers] } : {}),
          },
        ],
        summary: `Press ${[...(decision.modifiers ?? []), decision.key].join("+")}`,
        coordinateVisual: false,
      };
    case "drag": {
      const source = find(decision.candidateId);
      const destination = find(decision.targetCandidateId);
      if (!source && !decision.point) {
        throw new Error(`act: the model chose an unknown drag source (${decision.candidateId})`);
      }
      if (!destination && !decision.targetPoint) {
        throw new Error(
          `act: the model chose an unknown drag destination (${decision.targetCandidateId})`,
        );
      }
      const from = source ? source.target : pointTargetForDecision(decision.point!, geometry);
      const to = destination
        ? destination.target
        : pointTargetForDecision(decision.targetPoint!, geometry);
      const sourceLabel =
        source?.label ?? source?.identifier ?? `(${decision.point?.x}, ${decision.point?.y})`;
      const destinationLabel =
        destination?.label ??
        destination?.identifier ??
        `(${decision.targetPoint?.x}, ${decision.targetPoint?.y})`;
      return {
        steps: [{ kind: "drag", from, to }],
        summary: `Drag ${sourceLabel} to ${destinationLabel}`,
        coordinateVisual: !source || !destination,
      };
    }
    case "upload-file": {
      const candidate = find(decision.candidateId);
      if (decision.candidateId && !candidate) {
        throw new Error(`act: the model chose an unknown control (${decision.candidateId})`);
      }
      return {
        steps: [
          {
            kind: "upload-file",
            file: decision.file,
            ...(candidate ? { target: candidate.target } : {}),
          },
        ],
        summary: `Attach ${JSON.stringify(decision.file)}${candidate?.label ? ` to ${candidate.label}` : ""}`,
        coordinateVisual: false,
      };
    }
    case "switch-tab":
      return {
        steps: [
          {
            kind: "switch-tab",
            ...(decision.index !== undefined ? { index: decision.index } : {}),
            ...(decision.url ? { url: decision.url } : {}),
          },
        ],
        summary:
          decision.index !== undefined
            ? `Switch to browser tab ${decision.index + 1}`
            : `Switch to the browser tab matching ${JSON.stringify(decision.url)}`,
        coordinateVisual: false,
      };
    case "scroll":
      return {
        steps: [{ kind: "scroll", direction: decision.direction ?? "down" }],
        summary: `Scroll ${decision.direction ?? "down"}`,
        coordinateVisual: false,
      };
    case "back":
      return { steps: [{ kind: "key", key: "back" }], summary: "Go back", coordinateVisual: false };
    case "wait": {
      const ms = decision.ms ?? 1_000;
      return {
        steps: [{ kind: "sleep", ms }],
        summary: ms === 1_000 ? "Wait" : `Wait ${ms}ms`,
        coordinateVisual: false,
      };
    }
  }
}

/** Translate one decision — atomic or batch — into concrete recipe steps. A
 * batch concatenates its items in order; execution aborts the remainder on
 * the first failure. */
export function concreteStepsForDecision(
  decision: ActDecision,
  candidates: ActCandidate[],
  geometry?: ActObservationGeometry,
): ConcreteActSteps {
  if (decision.action === "batch") {
    const steps: RecipeStep[] = [];
    const summaries: string[] = [];
    let coordinateVisual = false;
    for (const item of decision.actions) {
      const concrete = concreteStepsForAtomic(item, candidates, geometry);
      steps.push(...concrete.steps);
      summaries.push(concrete.summary);
      coordinateVisual ||= concrete.coordinateVisual;
    }
    return { steps, summary: summaries.join(" → "), coordinateVisual };
  }
  if (decision.action === "done" || decision.action === "impossible") {
    return { steps: [], summary: decision.action, coordinateVisual: false };
  }
  return concreteStepsForAtomic(decision, candidates, geometry);
}

/** Atomic summaries for batch execution evidence, aligned with the batch items. */
export function atomicSummariesForBatch(
  decision: ActDecision,
  candidates: ActCandidate[],
  geometry?: ActObservationGeometry,
): string[] {
  if (decision.action !== "batch") return [];
  return decision.actions.map((item) => concreteStepsForAtomic(item, candidates, geometry).summary);
}
