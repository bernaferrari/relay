/**
 * Browser actuation verbs that have no device-facade equivalent: hover,
 * native-select option choice, bounded keyboard chords, and horizontal
 * scroll. They are browser-only by contract — the recipe platform gate
 * rejects them on native targets — and they run through the same
 * admission/supervision discipline as every other managed-browser mutation.
 */
import type { PressKeyModifier, PressKeyName, StepTarget } from "@relay/protocol";
import type { Page } from "playwright-core";
import type { Device } from "../device/device.js";
import { currentTargetContext } from "../target/target-context.js";
import { activePage, browserProofSessionForTarget, type BrowserSession } from "./browser-target.js";
import { locatorFor } from "./browser-target-locator.js";
import { browserAccountSchedulingKey } from "./browser-account-lane.js";
import { runBrowserMutationAdmission } from "./browser-mutation-admission.js";
import { browserSessionForDevice } from "./browser-live-handles.js";

async function actuationSession(device?: Device): Promise<BrowserSession> {
  const bound = device ? browserSessionForDevice(device) : undefined;
  if (bound) return bound;
  const context = currentTargetContext();
  if (context.kind !== "browser") {
    throw new Error("This actuation requires a browser target");
  }
  return browserProofSessionForTarget(context.targetId);
}

function mutationLane(session: BrowserSession): string {
  return browserAccountSchedulingKey(
    session.targetId,
    session.profile.authenticationFixtureId,
    session.unsignedLaneId,
  );
}

function quotedSelectorField(field: "id" | "label", value: string): string {
  return `${field}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The semantic locator input shared by the actuation verbs. Only identifier
 * and label strategies exist here because those are the keys the snapshot
 * pipeline can prove; anything else must arrive as an explicit point. */
export function browserActuationLocatorInput(target: StepTarget): { selector: string } {
  const identifier = target.identifier?.trim();
  if (identifier) return { selector: quotedSelectorField("id", identifier) };
  const label = target.label?.trim();
  if (label) return { selector: quotedSelectorField("label", label) };
  throw new Error("browser actuation requires an identifier or label target");
}

function targetPoint(target: StepTarget): { x: number; y: number } | undefined {
  const point = target.point;
  if (!point || point.relativeTo) return undefined;
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

type BrowserActuationTarget = StepTarget;

async function resolveActuation(
  page: Page,
  target: BrowserActuationTarget,
): Promise<
  | { kind: "locator"; locator: Awaited<ReturnType<typeof locatorFor>> }
  | { kind: "point"; x: number; y: number }
> {
  const point = targetPoint(target);
  if (!target.identifier?.trim() && !target.label?.trim()) {
    if (point) return { kind: "point", x: point.x, y: point.y };
    throw new Error("browser actuation requires an identifier, label, or point target");
  }
  try {
    return {
      kind: "locator",
      locator: await locatorFor(page, browserActuationLocatorInput(target)),
    };
  } catch (error) {
    if (!point) throw error;
    // A point recorded alongside the semantic keys is snapshot geometry, not
    // an unreviewed fallback: the semantic miss wins unless it is mere absence.
    if (error instanceof Error && error.message.includes("did not match")) {
      return { kind: "point", x: point.x, y: point.y };
    }
    throw error;
  }
}

/** Hover a semantic target or explicit point. Hover never clicks; a missing
 * target fails rather than wandering to the wrong control. */
export async function hoverBrowserTarget(target: StepTarget, device?: Device): Promise<void> {
  const session = await actuationSession(device);
  const page = await activePage(session);
  await runBrowserMutationAdmission(mutationLane(session), async () => {
    const resolved = await resolveActuation(page, target);
    if (resolved.kind === "point") {
      await page.mouse.move(resolved.x, resolved.y);
      return;
    }
    await resolved.locator.hover();
  });
}

/** Choose a visible option of a native HTML select. Playwright refuses a
 * non-select element, and that refusal is the honest answer for listbox
 * widgets: those are ordinary taps, not this verb. */
export async function selectBrowserOption(
  target: StepTarget,
  option: string,
  device?: Device,
): Promise<void> {
  const session = await actuationSession(device);
  const page = await activePage(session);
  await runBrowserMutationAdmission(mutationLane(session), async () => {
    if (!target.identifier?.trim() && !target.label?.trim()) {
      throw new Error("select requires an identifier or label target");
    }
    const locator = await locatorFor(page, browserActuationLocatorInput(target));
    const chosen = await locator.selectOption({ label: option });
    if (!chosen.includes(option) && chosen.length === 0) {
      throw new Error(`select: no option visible as ${JSON.stringify(option)}`);
    }
  });
}

const PLAYWRIGHT_KEY_NAMES: Record<PressKeyName, string> = {
  escape: "Escape",
  tab: "Tab",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  a: "a",
  c: "c",
  k: "k",
  v: "v",
  x: "x",
  z: "z",
};

const PLAYWRIGHT_MODIFIER_NAMES: Record<PressKeyModifier, string> = {
  control: "Control",
  meta: "Meta",
  shift: "Shift",
  alt: "Alt",
  controlOrMeta: "ControlOrMeta",
};

const LETTER_KEYS = new Set<PressKeyName>(["a", "c", "k", "v", "x", "z"]);

/** One bounded keyboard chord. Letter keys are shortcut chords, so they must
 * carry a control-ish modifier; bare letters belong to type steps. This is
 * the single enforcement point for the allowlist, so a hand-authored step and
 * a model-emitted step answer the same way. */
export function browserPressKeyChord(
  key: PressKeyName,
  modifiers: readonly PressKeyModifier[] = [],
): string {
  const unique = [...new Set(modifiers)];
  if (
    LETTER_KEYS.has(key) &&
    !unique.some(
      (modifier) => modifier === "control" || modifier === "meta" || modifier === "controlOrMeta",
    )
  ) {
    throw new Error(
      `press-key: letter key ${JSON.stringify(key)} requires a control or meta modifier; use a type step for literal text`,
    );
  }
  if ((key === "escape" || key === "tab") && unique.some((m) => m === "controlOrMeta")) {
    // ControlOrMeta is a shortcut affordance; Escape/Tab chords name the real modifier.
    throw new Error(`press-key: ${key} chords must name control or meta explicitly`);
  }
  const chord = [
    ...unique.map((modifier) => PLAYWRIGHT_MODIFIER_NAMES[modifier]),
    PLAYWRIGHT_KEY_NAMES[key],
  ].join("+");
  return chord;
}

export async function pressBrowserKey(
  key: PressKeyName,
  modifiers: readonly PressKeyModifier[] = [],
  device?: Device,
): Promise<void> {
  const chord = browserPressKeyChord(key, modifiers);
  const session = await actuationSession(device);
  const page = await activePage(session);
  await runBrowserMutationAdmission(mutationLane(session), async () => {
    await page.keyboard.press(chord);
  });
}

/** Horizontal wheel scroll. Positive deltaX reveals content to the right,
 * matching the vertical convention where positive deltaY reveals content
 * below. */
export async function scrollBrowserHorizontal(
  direction: "left" | "right",
  amount = 0.5,
  device?: Device,
): Promise<void> {
  const session = await actuationSession(device);
  const page = await activePage(session);
  await runBrowserMutationAdmission(mutationLane(session), async () => {
    const viewportWidth = page.viewportSize()?.width ?? 1_000;
    const distance = viewportWidth * amount;
    await page.mouse.wheel(direction === "left" ? -distance : distance, 0);
  });
}

/** Runner-facing dispatch for the browser-only actuation step kinds. The
 * platform gate rejects these steps on native targets long before execution;
 * the failure path here is a second closed door, not the only one. */
export async function runBrowserActuationStep(
  device: Device,
  step:
    | { kind: "hover"; target: StepTarget }
    | { kind: "select"; target: StepTarget; option: string }
    | { kind: "press-key"; key: PressKeyName; modifiers?: PressKeyModifier[] },
  onSettled: () => void,
): Promise<void> {
  try {
    if (step.kind === "hover") await hoverBrowserTarget(step.target, device);
    else if (step.kind === "select") await selectBrowserOption(step.target, step.option, device);
    else await pressBrowserKey(step.key, step.modifiers ?? [], device);
  } finally {
    onSettled();
  }
}
