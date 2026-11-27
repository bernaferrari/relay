/**
 * Browser actuation verbs that have no device-facade equivalent: hover,
 * native-select option choice, bounded keyboard chords, horizontal scroll,
 * drag-and-drop, workspace file attachment, and tab switching. They are
 * browser-only by contract — the recipe platform gate rejects them on native
 * targets — and they run through the same admission/supervision discipline
 * as every other managed-browser mutation.
 */
import type { PressKeyModifier, PressKeyName, StepTarget } from "@relay/protocol";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Locator, Page } from "playwright-core";
import type { Device } from "../device/device.js";
import { currentTargetContext } from "../target/target-context.js";
import { findWorkspaceRoot } from "../workspace/workspace-root.js";
import { activePage, browserProofSessionForTarget, type BrowserSession } from "./browser-target.js";
import { locatorFor } from "./browser-target-locator.js";
import { browserAccountSchedulingKey } from "./browser-account-lane.js";
import { runBrowserMutationAdmission } from "./browser-mutation-admission.js";
import { browserSessionForDevice } from "./browser-live-handles.js";
import { uploadBrowserFile } from "./browser-live-controls.js";

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

/** Intermediate pointer moves in one drag. Enough for drag-start thresholds
 * and pointermove-driven reorder logic without turning the gesture into a
 * slideshow. */
const DRAG_POINTER_STEPS = 12;

/** Keyboard arrows are the slider fallback, not the primary mechanism: a
 * trusted mouse drag is what the control is for. The cap keeps the fallback
 * bounded when the keyboard never reaches the intended value. */
export const MAX_SLIDER_KEY_PRESSES = 20;

type DragEndpoint = {
  x: number;
  y: number;
  width: number;
  height: number;
  locator?: Locator;
};

/** Resolve one drag end to viewport coordinates. Semantic targets contribute
 * their current box center; explicit points actuate where they were authored.
 * An invisible semantic end fails rather than dragging from nowhere. */
async function dragEndpoint(
  page: Page,
  target: StepTarget,
  end: "from" | "to",
): Promise<DragEndpoint> {
  const resolved = await resolveActuation(page, target);
  if (resolved.kind === "point") {
    return { x: resolved.x, y: resolved.y, width: 0, height: 0 };
  }
  const locator = resolved.locator;
  await locator.scrollIntoViewIfNeeded({ timeout: 2_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`drag: the ${end} target is not visible`);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    width: box.width,
    height: box.height,
    locator,
  };
}

/** Readable state of a native range input or ARIA slider; anything else —
 * including an element the drop just re-rendered away — is not a slider. */
async function readSliderState(
  locator: Locator,
): Promise<{ value: number; min: number; max: number } | undefined> {
  try {
    return await locator.evaluate((element) => {
      if (element instanceof HTMLInputElement && element.type === "range") {
        return {
          value: Number(element.value),
          min: element.min === "" ? 0 : Number(element.min),
          max: element.max === "" ? 100 : Number(element.max),
        };
      }
      if (element.getAttribute("role") === "slider") {
        const value = Number(element.getAttribute("aria-valuenow"));
        if (!Number.isFinite(value)) return undefined;
        return {
          value,
          min: Number(element.getAttribute("aria-valuemin") ?? 0),
          max: Number(element.getAttribute("aria-valuemax") ?? 100),
        };
      }
      return undefined;
    });
  } catch {
    return undefined;
  }
}

/** Drag a semantic target or point onto another. The primary mechanism is one
 * stepped trusted mouse path: pointer-events drags see their move sequence and
 * Chromium's input pipeline raises HTML5 drag events for trusted input, so one
 * mechanism honestly covers both drag families. When the source is a slider
 * whose value did not move — the thumb is small and track clicks can cancel —
 * bounded arrow keys carry it toward the value the drag geometry intended. */
export async function dragBrowserTarget(
  from: StepTarget,
  to: StepTarget,
  device?: Device,
): Promise<void> {
  const session = await actuationSession(device);
  const page = await activePage(session);
  await runBrowserMutationAdmission(mutationLane(session), async () => {
    const source = await dragEndpoint(page, from, "from");
    const destination = await dragEndpoint(page, to, "to");
    const sliderBefore = source.locator ? await readSliderState(source.locator) : undefined;
    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    for (let stepIndex = 1; stepIndex <= DRAG_POINTER_STEPS; stepIndex += 1) {
      await page.mouse.move(
        source.x + ((destination.x - source.x) * stepIndex) / DRAG_POINTER_STEPS,
        source.y + ((destination.y - source.y) * stepIndex) / DRAG_POINTER_STEPS,
      );
    }
    await page.mouse.up();
    if (!sliderBefore || !source.locator) return;
    const sliderAfter = await readSliderState(source.locator);
    if (!sliderAfter || sliderAfter.value !== sliderBefore.value) return;
    await keyboardSliderFallback(source.locator, sliderBefore, source, destination);
  });
}

/** Bounded arrow-key movement toward the value the drag geometry implied.
 * Stops at the intended value, at the slider's own end stop, or at the cap —
 * never an open-ended key loop. */
async function keyboardSliderFallback(
  locator: Locator,
  before: { value: number; min: number; max: number },
  source: DragEndpoint,
  destination: DragEndpoint,
): Promise<void> {
  const horizontal = Math.abs(destination.x - source.x) >= Math.abs(destination.y - source.y);
  const span = horizontal ? source.width : source.height;
  const travel = horizontal ? destination.x - source.x : -(destination.y - source.y);
  // Vertical sliders increase upward; horizontal sliders increase rightward.
  const intended =
    span > 0 && before.max > before.min
      ? before.value + (travel / span) * (before.max - before.min)
      : travel > 0
        ? before.max
        : before.min;
  if (intended === before.value) return;
  const increasing = intended > before.value;
  const key = horizontal
    ? increasing
      ? "ArrowRight"
      : "ArrowLeft"
    : increasing
      ? "ArrowUp"
      : "ArrowDown";
  await locator.focus();
  let value = before.value;
  for (let press = 0; press < MAX_SLIDER_KEY_PRESSES; press += 1) {
    if (increasing ? value >= intended : value <= intended) return;
    await locator.press(key);
    const current = await readSliderState(locator);
    if (!current || current.value === value) return;
    value = current.value;
  }
}

/** Small-file bound for workspace attachments. Test fixtures are images,
 * documents, and short media; anything larger is not a file-input fixture. */
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;

/** Resolve a workspace-relative upload reference to a real file inside the
 * workspace root. Absolute paths, `..` escapes, and symlinks pointing outside
 * the workspace are all traversal: an act decision must never become a path
 * to arbitrary host files. */
export async function resolveWorkspaceUploadFile(
  file: string,
  workspaceRoot?: string,
): Promise<string> {
  const trimmed = file.trim();
  if (!trimmed) throw new Error("upload-file: file must be a non-empty workspace-relative path");
  if (isAbsolute(trimmed)) {
    throw new Error("upload-file: file must be workspace-relative, not absolute");
  }
  const rootInput =
    workspaceRoot ?? process.env.RELAY_WORKSPACE_ROOT?.trim() ?? findWorkspaceRoot();
  const root = await realpath(rootInput);
  let real: string;
  try {
    real = await realpath(resolve(root, trimmed));
  } catch {
    throw new Error(`upload-file: ${JSON.stringify(trimmed)} does not exist in the workspace`);
  }
  const local = relative(root, real);
  if (isAbsolute(local) || local === ".." || local.startsWith("../") || local === "") {
    throw new Error(`upload-file: ${JSON.stringify(trimmed)} escapes the workspace root`);
  }
  const stats = await stat(real);
  if (!stats.isFile()) throw new Error(`upload-file: ${JSON.stringify(trimmed)} is not a file`);
  if (stats.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error(
      `upload-file: ${JSON.stringify(trimmed)} is ${stats.size} bytes; the small-file limit is ${MAX_UPLOAD_FILE_BYTES}`,
    );
  }
  return real;
}

/** Attach a workspace file to a file input. The path is proven inside the
 * workspace before any browser input; the attachment itself is the same
 * mutation-admission path the reviewed upload step uses. */
export async function uploadBrowserWorkspaceFile(
  file: string,
  target: StepTarget | undefined,
  device?: Device,
): Promise<void> {
  const path = await resolveWorkspaceUploadFile(file);
  await uploadBrowserFile(path, target, device);
}

/** Which page is active after a tab switch. Recorded as step evidence: the
 * index within the context's open pages, the page's URL and title, and how
 * many pages were open. */
export type BrowserTabSwitchEvidence = {
  index: number;
  url: string;
  title: string;
  pages: number;
};

/** Switch the session's active page by index or by a URL substring matching
 * exactly one open page. Ambiguity and absence both fail closed: guessing a
 * tab would direct every later input at the wrong page. */
export async function switchBrowserTab(
  selector: { index?: number; url?: string },
  device?: Device,
): Promise<BrowserTabSwitchEvidence> {
  if ((selector.index === undefined) === (selector.url === undefined)) {
    throw new Error("switch-tab requires exactly one of index or url");
  }
  const session = await actuationSession(device);
  return await runBrowserMutationAdmission(mutationLane(session), async () => {
    const pages = session.context.pages().filter((page) => !page.isClosed());
    let chosen: Page | undefined;
    if (selector.index !== undefined) {
      chosen = pages[selector.index];
      if (!chosen) {
        throw new Error(
          `switch-tab: no open page at index ${selector.index} (${pages.length} open)`,
        );
      }
    } else {
      const needle = selector.url!;
      const matches = pages.filter((page) => page.url().includes(needle));
      if (matches.length === 0) {
        throw new Error(`switch-tab: no open page URL contains ${JSON.stringify(needle)}`);
      }
      if (matches.length > 1) {
        throw new Error(
          `switch-tab: ${matches.length} open pages match ${JSON.stringify(needle)}; the match must name exactly one`,
        );
      }
      chosen = matches[0]!;
    }
    await chosen.bringToFront();
    session.page = chosen;
    return {
      index: pages.indexOf(chosen),
      url: chosen.url(),
      title: await chosen.title(),
      pages: pages.length,
    };
  });
}

/** Runner-facing dispatch for the browser-only actuation step kinds. The
 * platform gate rejects these steps on native targets long before execution;
 * the failure path here is a second closed door, not the only one. Returns
 * the active-page evidence when the step switched browser tabs. */
export async function runBrowserActuationStep(
  device: Device,
  step:
    | { kind: "hover"; target: StepTarget }
    | { kind: "select"; target: StepTarget; option: string }
    | { kind: "press-key"; key: PressKeyName; modifiers?: PressKeyModifier[] }
    | { kind: "drag"; from: StepTarget; to: StepTarget }
    | { kind: "upload-file"; file: string; target?: StepTarget }
    | { kind: "switch-tab"; index?: number; url?: string },
  onSettled: () => void,
): Promise<BrowserTabSwitchEvidence | undefined> {
  try {
    if (step.kind === "hover") await hoverBrowserTarget(step.target, device);
    else if (step.kind === "select") await selectBrowserOption(step.target, step.option, device);
    else if (step.kind === "press-key")
      await pressBrowserKey(step.key, step.modifiers ?? [], device);
    else if (step.kind === "drag") await dragBrowserTarget(step.from, step.to, device);
    else if (step.kind === "upload-file") {
      await uploadBrowserWorkspaceFile(step.file, step.target, device);
    } else return await switchBrowserTab(step, device);
    return undefined;
  } finally {
    onSettled();
  }
}
