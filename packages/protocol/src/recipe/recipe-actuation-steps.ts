/**
 * Browser-only actuation step contracts. These are physical interactions a
 * browser target can prove; native platforms reject them at the platform
 * gate rather than silently no-oping. They live in a sibling module because
 * recipes.ts is at its source budget; the RecipeStep union there references
 * these shapes by name.
 */
import type { PressKeyModifier, PressKeyName, StepTarget } from "../recipes.js";

export type HoverStep = {
  /** Hover the pointer over a semantic target without clicking. Browser
   * targets only: reveals hover-only menus, tooltips, and affordances. */
  kind: "hover";
  target: StepTarget;
};

export type SelectStep = {
  /** Choose a visible option of a native HTML select. Browser targets
   * only; custom listbox widgets are ordinary taps instead. */
  kind: "select";
  target: StepTarget;
  option: string;
};

export type PressKeyStep = {
  /** One bounded keyboard key or shortcut chord. Browser targets only.
   * Letter keys are shortcut chords and require a control-ish modifier;
   * literal text entry belongs to `type` steps. */
  kind: "press-key";
  key: PressKeyName;
  modifiers?: PressKeyModifier[];
};

export type DragStep = {
  /** Drag from one semantic target or point to another: drag-and-drop
   * reordering, canvas gestures, and slider movement. Browser targets only.
   * The primary mechanism is a stepped trusted mouse path; sliders that did
   * not move receive a bounded keyboard-arrow fallback. */
  kind: "drag";
  from: StepTarget;
  to: StepTarget;
};

export type UploadFileStep = {
  /** Attach a workspace file to a file input (or the file chooser a semantic
   * attach control opens). Browser targets only. The file reference must be
   * workspace-relative and stay inside the workspace root after symlink
   * resolution — an act step can never be a path out of the workspace — and
   * only small files are eligible. */
  kind: "upload-file";
  file: string;
  target?: StepTarget;
};

export type SwitchTabStep = {
  /** Switch the active browser page by index or by a URL substring that
   * matches exactly one open page: OAuth popups and target=_blank flows.
   * Browser targets only. Exactly one of index/url is required. */
  kind: "switch-tab";
  index?: number;
  url?: string;
};
