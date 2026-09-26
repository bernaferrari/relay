import {
  assertAuthoringSessionRef,
  parseAuthoringSessionListResponse,
  parseAuthoringSessionResponse,
  type AuthoringInteraction,
  type AuthoringSessionListResponse,
  type AuthoringSessionResponse,
  type CommitAuthoringSessionInput,
  type ReorderAuthoringTakeInput,
  type ReplaceAuthoringActionInput,
  type TrimAuthoringTakeInput,
} from "./authoring.js";
import type { OperationInput } from "./operation-map.js";
import type { RuntimeParser } from "./operation-contract.js";
import {
  boolean,
  fail,
  number,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";

export function assertAuthoringInteraction(value: unknown): void {
  const interaction = record(value, "authoring interaction");
  const kind = string(interaction.kind, "authoring interaction kind");
  if (interaction.applied !== undefined)
    boolean(interaction.applied, "authoring interaction applied");
  switch (kind) {
    case "tap":
      record(interaction.target, "tap target");
      return;
    case "type":
      string(interaction.text, "type text");
      if (interaction.target !== undefined) record(interaction.target, "type target");
      if (
        interaction.mode !== undefined &&
        interaction.mode !== "append" &&
        interaction.mode !== "replace"
      )
        fail("type mode", "must be append or replace");
      if (interaction.mode === "replace" && interaction.target === undefined)
        fail("type target", "is required in replace mode");
      return;
    case "clipboard":
      if (!(["write", "read", "paste", "copy"] as unknown[]).includes(interaction.action))
        fail("clipboard action", "must be write, read, paste, or copy");
      if (interaction.text !== undefined) string(interaction.text, "clipboard text");
      if (interaction.expect !== undefined) string(interaction.expect, "clipboard expectation");
      if (interaction.target !== undefined) record(interaction.target, "clipboard target");
      if (
        interaction.match !== undefined &&
        !["exact", "contains"].includes(String(interaction.match))
      )
        fail("clipboard match", "must be exact or contains");
      return;
    case "app":
      if (
        ![
          "open",
          "close",
          "switcher",
          "inspect",
          "assert-installed",
          "assert-not-installed",
          "install",
          "update",
          "uninstall",
        ].includes(String(interaction.action))
      )
        fail("app action", "is not supported");
      for (const field of ["app", "url", "artifact", "as", "version"] as const) {
        if (interaction[field] !== undefined) string(interaction[field], `app ${field}`);
      }
      if (interaction.relaunch !== undefined) boolean(interaction.relaunch, "app relaunch");
      if (
        interaction.versionMatch !== undefined &&
        !["exact", "contains"].includes(String(interaction.versionMatch))
      )
        fail("app versionMatch", "must be exact or contains");
      return;
    case "device":
      if (
        !["lock", "unlock", "keyboard-dismiss", "keyboard-enter"].includes(
          String(interaction.action),
        )
      )
        fail("device action", "is not supported");
      return;
    case "rotate":
      if (
        !["portrait", "portrait-upside-down", "landscape-left", "landscape-right"].includes(
          String(interaction.orientation),
        )
      )
        fail("rotation orientation", "is not supported");
      return;
    case "swipe":
      record(interaction.from, "swipe from");
      record(interaction.to, "swipe to");
      if (
        interaction.durationMs !== undefined &&
        number(interaction.durationMs, "swipe duration") < 0
      )
        fail("swipe duration", "must be non-negative");
      return;
    case "key":
      if (interaction.key !== "back" && interaction.key !== "home" && interaction.key !== "recents")
        fail("authoring key", "must be back, home, or recents");
      return;
    case "wait":
      if (number(interaction.ms, "wait ms") < 0) fail("wait ms", "must be non-negative");
      return;
    case "observe":
    case "screenshot":
      if (interaction.fullPage !== undefined) boolean(interaction.fullPage, "fullPage");
      if (interaction.label !== undefined) string(interaction.label, "observe label");
      return;
    case "reusable":
      string(interaction.recipeId, "reusable recipeId");
      if (interaction.bindings !== undefined) record(interaction.bindings, "reusable bindings");
      return;
    case "steps":
      if (!Array.isArray(interaction.steps)) fail("manual steps", "must be an array");
      for (const step of interaction.steps) record(step, "manual step");
      if (interaction.label !== undefined) string(interaction.label, "manual step label");
      return;
    default:
      fail("authoring interaction kind", `unsupported kind ${kind}`);
  }
}

export const authoringSessionRefParser = objectParser<{ sessionId: string }>(
  "authoring session input",
  assertAuthoringSessionRef,
);

export const authoringInteractionParser = objectParser<{
  sessionId: string;
  interaction: AuthoringInteraction;
}>("authoring interaction input", (input) => {
  assertAuthoringSessionRef(input);
  assertAuthoringInteraction(input.interaction);
});

export const trimAuthoringTakeParser = objectParser<TrimAuthoringTakeInput>(
  "trim authoring Take input",
  (input) => {
    assertAuthoringSessionRef(input);
    const fromMs = input.fromMs === undefined ? undefined : number(input.fromMs, "trim fromMs");
    const toMs = input.toMs === undefined ? undefined : number(input.toMs, "trim toMs");
    if (fromMs !== undefined && fromMs < 0) fail("trim fromMs", "must be non-negative");
    if (toMs !== undefined && toMs < 0) fail("trim toMs", "must be non-negative");
    if (fromMs !== undefined && toMs !== undefined && fromMs > toMs)
      fail("trim range", "fromMs must not exceed toMs");
    if (
      input.actionIds !== undefined &&
      (!Array.isArray(input.actionIds) ||
        input.actionIds.some((id) => typeof id !== "string" || !id))
    )
      fail("trim actionIds", "must be non-empty strings");
  },
);

export const reorderAuthoringTakeParser = objectParser<ReorderAuthoringTakeInput>(
  "reorder authoring Take input",
  (input) => {
    assertAuthoringSessionRef(input);
    if (
      !Array.isArray(input.actionIds) ||
      input.actionIds.some((id) => typeof id !== "string" || !id)
    )
      fail("reorder actionIds", "must be non-empty strings");
  },
);

export const replaceAuthoringActionParser = objectParser<ReplaceAuthoringActionInput>(
  "replace authoring action input",
  (input) => {
    assertAuthoringSessionRef(input);
    string(input.actionId, "actionId");
    assertAuthoringInteraction(input.interaction);
  },
);

export const commitAuthoringSessionParser = objectParser<CommitAuthoringSessionInput>(
  "commit authoring session input",
  (input) => {
    assertAuthoringSessionRef(input);
    if (input.destination !== undefined) {
      const destination = record(input.destination, "authoring destination");
      if (!["new-screen", "screen", "end"].includes(String(destination.kind)))
        fail("authoring destination kind", "must be new-screen, screen, or end");
      if (destination.kind === "screen") string(destination.screenId, "destination screenId");
      if (destination.kind === "new-screen" && destination.title !== undefined)
        string(destination.title, "destination title");
    }
    if (input.createTest !== undefined && input.createTest !== true)
      fail("authoring createTest", "must be true");
    if (input.testName !== undefined) string(input.testName, "authoring Test name");
  },
);

export const authoringSessionResponseParser: RuntimeParser<AuthoringSessionResponse> = {
  description: "authoring session response",
  parse: parseAuthoringSessionResponse,
};

export const authoringSessionListParser: RuntimeParser<AuthoringSessionListResponse> = {
  description: "authoring session list response",
  parse: parseAuthoringSessionListResponse,
};

export const authoringSessionListInputParser = objectParser<
  OperationInput<"authoring.session.list">
>("authoring session list input", (input) => {
  if (input.appMapId !== undefined) string(input.appMapId, "authoring App Map id");
  if (input.targetId !== undefined) string(input.targetId, "authoring target id");
  if (input.activeOnly !== undefined) {
    if (input.activeOnly === "true") input.activeOnly = true;
    if (input.activeOnly === "false") input.activeOnly = false;
    boolean(input.activeOnly, "authoring activeOnly");
  }
  if (input.latestRevisionOnly !== undefined) {
    if (input.latestRevisionOnly === "true") input.latestRevisionOnly = true;
    if (input.latestRevisionOnly === "false") input.latestRevisionOnly = false;
    boolean(input.latestRevisionOnly, "authoring latestRevisionOnly");
  }
});
