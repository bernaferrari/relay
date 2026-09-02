import type { RecipeStep } from "../context/server";
import { createTapStep } from "../lib/take-action-conversion";
import { sentenceForStep } from "../lib/step-sentence";
import type { TitledId } from "../lib/job";
import type { IconName } from "./icon";

export type AddOption = { label: string; make: () => RecipeStep };
export type AddGroup = { label: string; items: AddOption[] };

export function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    tap: "Tap",
    type: "Type",
    expect: "Check",
    "expect-set": "Options",
    extract: "Extract",
    "assert-content": "Assert",
    "assert-layout": "Layout check",
    "evaluate-semantic": "Evaluate",
    "wait-for": "Wait",
    "wait-response": "Response",
    sleep: "Sleep",
    pause: "Human",
    review: "Review",
    key: "Key",
    scroll: "Scroll",
    swipe: "Swipe",
    screenshot: "Shot",
    tour: "Tour",
    flow: "Named path",
    module: "Reuse",
    branch: "Branch",
    repeat: "Repeat",
    script: "Script",
    clipboard: "Clipboard",
    app: "App",
    device: "Device",
    rotate: "Rotate",
    settings: "Setting",
    location: "Location",
    permission: "Permission",
    alert: "Alert",
    network: "Network",
    logs: "Logs",
  };
  return labels[kind] ?? kind;
}

export function kindIcon(kind: RecipeStep["kind"]): IconName {
  if (kind === "tap") return "pointer";
  if (["type", "key", "clipboard"].includes(kind)) return "keyboard";
  if (
    ["expect", "expect-set", "assert-content", "assert-layout", "evaluate-semantic"].includes(kind)
  )
    return "check";
  if (["wait-for", "wait-response", "sleep", "pause", "review"].includes(kind)) return "clock";
  if (["screenshot", "extract", "tour"].includes(kind)) return "camera";
  if (["flow", "module", "branch", "repeat"].includes(kind)) return "move";
  if (["device", "rotate"].includes(kind)) return "smartphone";
  if (kind === "app") return "grid";
  if (["network", "logs"].includes(kind)) return "wave";
  return "bolt";
}

export function stepDetail(step: RecipeStep, recipes: Iterable<TitledId>): string {
  const sentence = sentenceForStep(step, recipes);
  const prefixes: Partial<Record<RecipeStep["kind"], string[]>> = {
    tap: ["Tap "],
    type: ["Type "],
    expect: ["Check "],
    "expect-set": ["Check options are exactly "],
    extract: ["Extract "],
    "assert-content": ["Check "],
    "assert-layout": ["Check "],
    "evaluate-semantic": ["Evaluate "],
    "wait-for": ["Wait until "],
    "wait-response": ["Wait for "],
    sleep: ["Wait "],
    key: ["Press "],
    scroll: ["Scroll "],
    swipe: ["Swipe "],
    screenshot: ["Screenshot · ", "Screenshot"],
    module: ["Run "],
    branch: ["When "],
    repeat: ["Repeat "],
    script: ["Transform "],
    clipboard: ["Set clipboard ", "Check clipboard ", "Read clipboard"],
    app: ["Open app ", "Open ", "Close "],
    device: ["Lock ", "Unlock ", "Dismiss ", "Press "],
    rotate: ["Rotate "],
    settings: ["Set "],
    location: ["Set location "],
    permission: ["Grant ", "Deny ", "Reset "],
    alert: ["Accept ", "Dismiss ", "Wait for ", "Inspect "],
    network: ["Capture network ", "Mark network "],
    logs: ["Start ", "Stop ", "Mark ", "Clear "],
  };
  for (const prefix of prefixes[step.kind] ?? []) {
    if (sentence === prefix) return "Capture screen";
    if (sentence.startsWith(prefix)) return sentence.slice(prefix.length);
  }
  return sentence;
}

export const ADD_GROUPS: AddGroup[] = [
  {
    label: "Interact",
    items: [
      { label: "Tap element", make: createTapStep },
      { label: "Type text", make: () => ({ kind: "type", text: "" }) },
      { label: "Scroll", make: () => ({ kind: "scroll", direction: "down" }) },
      {
        label: "Swipe",
        make: () => ({ kind: "swipe", from: { x: 360, y: 640 }, to: { x: 360, y: 360 } }),
      },
    ],
  },
  {
    label: "Device",
    items: [
      { label: "Go Back", make: () => ({ kind: "key", key: "back" }) },
      { label: "Go Home", make: () => ({ kind: "key", key: "home" }) },
      { label: "Open app or deep link", make: () => ({ kind: "app", action: "open", app: "" }) },
      { label: "Close / force-stop app", make: () => ({ kind: "app", action: "close", app: "" }) },
      { label: "Open app switcher", make: () => ({ kind: "app", action: "switcher" }) },
      { label: "Dismiss keyboard", make: () => ({ kind: "device", action: "keyboard-dismiss" }) },
      { label: "Lock device", make: () => ({ kind: "device", action: "lock" }) },
      { label: "Unlock device", make: () => ({ kind: "device", action: "unlock" }) },
      { label: "Rotate device", make: () => ({ kind: "rotate", orientation: "landscape-left" }) },
      {
        label: "Record app version",
        make: () => ({ kind: "app", action: "inspect", app: "", as: "app_version" }),
      },
      {
        label: "Check app is installed",
        make: () => ({ kind: "app", action: "assert-installed", app: "" }),
      },
      {
        label: "Check app is not installed",
        make: () => ({ kind: "app", action: "assert-not-installed", app: "" }),
      },
    ],
  },
  {
    label: "Wait & check",
    items: [
      {
        label: "Check element is visible",
        make: () => ({ kind: "expect", target: {}, condition: "visible" }),
      },
      {
        label: "Check element is gone",
        make: () => ({ kind: "expect", target: {}, condition: "gone" }),
      },
      {
        label: "Check exact option list",
        make: () => ({ kind: "expect-set", identifierPrefix: "", labels: [] }),
      },
      {
        label: "Extract response text",
        make: () => ({ kind: "extract", as: "response", target: {}, role: "assistant" }),
      },
      {
        label: "Check extracted content",
        make: () => ({
          kind: "assert-content",
          input: "response",
          expected: "",
          match: "contains",
        }),
      },
      {
        label: "Check elements do not overlap",
        make: () => ({
          kind: "assert-layout",
          relation: "non-overlap",
          first: {},
          second: {},
        }),
      },
      {
        label: "Evaluate response with AI",
        make: () => ({
          kind: "evaluate-semantic",
          input: "response",
          criteria: ["The response satisfies the requested intent."],
          threshold: 0.9,
        }),
      },
      { label: "Wait for element", make: () => ({ kind: "wait-for", target: {} }) },
      {
        label: "Wait for response to finish",
        make: () => ({ kind: "wait-response", target: {}, timeoutMs: 90_000, stableForMs: 2_000 }),
      },
      { label: "Wait (sleep)", make: () => ({ kind: "sleep", ms: 500 }) },
      {
        label: "Defer check for review",
        make: () => ({ kind: "review", capability: "", reason: "" }),
      },
      {
        label: "Check clipboard",
        make: () => ({ kind: "clipboard", action: "read", expect: "", match: "exact" }),
      },
    ],
  },
  {
    label: "Capture data",
    items: [
      { label: "Screenshot", make: () => ({ kind: "screenshot" }) },
      { label: "Set clipboard", make: () => ({ kind: "clipboard", action: "write", text: "" }) },
      {
        label: "Capture network",
        make: () => ({ kind: "network", action: "dump", include: "headers", limit: 100 }),
      },
      {
        label: "Mark device logs",
        make: () => ({ kind: "logs", action: "mark", message: "checkpoint" }),
      },
    ],
  },
  {
    label: "Reuse & logic",
    items: [
      { label: "Pause for human", make: () => ({ kind: "pause", message: "" }) },
      { label: "Attach saved path", make: () => ({ kind: "module", recipeId: "" }) },
      {
        label: "Branch to another test",
        make: () => ({
          kind: "branch",
          input: "response",
          operator: "contains",
          expected: "",
          thenRecipeId: "",
        }),
      },
      { label: "Repeat another test", make: () => ({ kind: "repeat", count: 3, recipeId: "" }) },
      {
        label: "Transform variables",
        make: () => ({ kind: "script", source: "set name = value" }),
      },
    ],
  },
  {
    label: "System setup",
    items: [
      {
        label: "Install or update APK",
        make: () => ({ kind: "app", action: "update", app: "", artifact: "" }),
      },
      { label: "Uninstall app", make: () => ({ kind: "app", action: "uninstall", app: "" }) },
      { label: "Set location", make: () => ({ kind: "location", latitude: 0, longitude: 0 }) },
      {
        label: "Set permission",
        make: () => ({ kind: "permission", action: "grant", permission: "camera" }),
      },
      { label: "Handle system alert", make: () => ({ kind: "alert", action: "accept" }) },
      {
        label: "Change device setting",
        make: () => ({ kind: "settings", setting: "wifi", state: "on" }),
      },
    ],
  },
];
