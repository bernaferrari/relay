import type { RecipeStep } from "../context/server";
import type { EditableActionKind } from "../lib/take-action-conversion";
import type { IconName } from "./icon";
import { kindIcon, kindLabel } from "./step-list-metadata";

export type ActionOption = {
  kind: EditableActionKind;
  label: string;
  description: string;
  icon: IconName;
};

export type ActionGroup = {
  id: string;
  label: string;
  actions: ActionOption[];
};

const labels: Partial<Record<RecipeStep["kind"], string>> = {
  expect: "Check element",
  "expect-set": "Check option list",
  "wait-for": "Wait for element",
  "wait-response": "Wait for response",
  sleep: "Wait a duration",
  screenshot: "Take screenshot",
  pause: "Pause for person",
  extract: "Extract content",
  "assert-content": "Check content",
  "evaluate-semantic": "Evaluate response",
  module: "Reuse test",
  settings: "Change setting",
  logs: "Device logs",
};

const descriptions: Record<RecipeStep["kind"], string> = {
  tap: "Press an element or position",
  type: "Enter text",
  scroll: "Move by half or one screen",
  swipe: "Drag between two points",
  key: "Navigate Back or Home",
  expect: "Verify an element is visible or gone",
  "expect-set": "Verify the complete visible option list",
  "expect-screen": "Verify the map reached its expected screen",
  "wait-for": "Continue when an element appears",
  sleep: "Pause for a fixed time",
  pause: "Let a person complete a task",
  "wait-response": "Wait until a response is complete",
  "assert-content": "Compare saved content with text",
  "evaluate-semantic": "Judge content against criteria",
  screenshot: "Save the current screen",
  extract: "Save text from an element",
  clipboard: "Read or write the clipboard",
  network: "Capture requests and responses",
  logs: "Add or collect device logs",
  flow: "Run a named flow",
  module: "Run another test here",
  branch: "Choose a path from a condition",
  repeat: "Repeat another test",
  script: "Set or transform values",
  app: "Open, close, inspect, or manage an app",
  device: "Lock, unlock, or control the keyboard",
  rotate: "Change screen orientation",
  settings: "Change Wi-Fi or another setting",
  location: "Set the device location",
  permission: "Grant or revoke a permission",
  alert: "Accept or dismiss a system alert",
};

const group = (id: string, label: string, kinds: EditableActionKind[]): ActionGroup => ({
  id,
  label,
  actions: kinds.map((kind) => ({
    kind,
    label: labels[kind] ?? kindLabel(kind),
    description: descriptions[kind],
    icon: kindIcon(kind),
  })),
});

export const ACTION_GROUPS: ActionGroup[] = [
  group("interact", "Interact", ["tap", "type", "scroll", "swipe"]),
  group("wait-check", "Wait & check", [
    "expect",
    "expect-set",
    "wait-for",
    "sleep",
    "pause",
    "wait-response",
    "assert-content",
    "evaluate-semantic",
  ]),
  group("capture", "Capture data", ["screenshot", "extract", "clipboard", "network", "logs"]),
  group("logic", "Reuse & logic", ["flow", "module", "branch", "repeat", "script"]),
  group("device", "Device", [
    "key",
    "app",
    "device",
    "rotate",
    "settings",
    "location",
    "permission",
    "alert",
  ]),
];

export function actionLabelForKind(kind: RecipeStep["kind"]): string {
  return (
    ACTION_GROUPS.flatMap((entry) => entry.actions).find((action) => action.kind === kind)?.label ??
    kindLabel(kind)
  );
}

export function filterActionGroups(query: string): ActionGroup[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return ACTION_GROUPS;
  return ACTION_GROUPS.map((entry) => ({
    ...entry,
    actions: entry.actions.filter((action) =>
      `${action.label} ${action.description} ${entry.label}`
        .toLocaleLowerCase()
        .includes(normalized),
    ),
  })).filter((entry) => entry.actions.length > 0);
}
