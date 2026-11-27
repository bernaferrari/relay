import { parseAllDocuments } from "yaml";
import { UsageError } from "./errors.js";
import {
  capitalizeThe,
  compactCode,
  type ConvertedImportTest,
  humanizeFileStem,
  importComments,
  type ImportedStep,
  type ImportOverrides,
  kebabFileStem,
  renderRelayTestYaml,
  uniqueWarnings,
} from "./import-shared.js";

type MaestroConfig = {
  appId?: string;
  url?: string;
  name?: string;
};

type MaestroCommand = {
  name: string;
  value: unknown;
  index: number;
  raw: unknown;
};

type ConversionState = {
  warnings: string[];
  environmentNote: boolean;
};

type TargetText = {
  actionTarget: string;
  visibleSubject: string;
  omittedDetail: string[];
};

const INTERACTION_BEHAVIOR = new Set([
  "repeat",
  "delay",
  "retryTapIfNoChange",
  "waitToSettleTimeoutMs",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function warn(state: ConversionState, index: number, command: string, message: string): void {
  state.warnings.push(`step ${index}: skipped ${command}; ${message}`);
}

function note(state: ConversionState, index: number, command: string, message: string): void {
  state.warnings.push(`step ${index}: ${command} ${message}`);
}

function environmentText(value: string, state: ConversionState): string {
  let changed = false;
  const replaced = value.replace(/\$\{\s*([A-Za-z0-9_.-]+)\s*\}/gu, (_whole, name: string) => {
    changed = true;
    return `{{${name}}}`;
  });
  if (changed && !state.environmentNote) {
    state.environmentNote = true;
    state.warnings.push(
      "environment values were rewritten as Relay {{NAME}} inputs; provide those inputs when running",
    );
  }
  return replaced;
}

function targetText(
  value: unknown,
  state: ConversionState,
  representedDetail: readonly string[] = [],
): TargetText | undefined {
  if (typeof value === "string" && value.trim()) {
    const label = environmentText(value.trim(), state);
    return {
      actionTarget: `"${label}"`,
      visibleSubject: label,
      omittedDetail: [],
    };
  }
  if (!isRecord(value)) return undefined;
  const label = text(value.text);
  const identifier = text(value.id);
  if (!label && !identifier) return undefined;
  const omittedDetail = Object.keys(value).filter(
    (key) =>
      key !== "text" &&
      key !== "id" &&
      !INTERACTION_BEHAVIOR.has(key) &&
      !representedDetail.includes(key),
  );
  if (identifier) {
    const resolved = environmentText(identifier, state);
    return {
      actionTarget: `the control with identifier ${resolved}`,
      visibleSubject: `the control with identifier ${resolved}`,
      omittedDetail,
    };
  }
  const resolved = environmentText(label!, state);
  return {
    actionTarget: `"${resolved}"`,
    visibleSubject: resolved,
    omittedDetail,
  };
}

function warnOmittedTargetDetail(
  state: ConversionState,
  index: number,
  command: string,
  target: TargetText,
): void {
  if (!target.omittedDetail.length) return;
  note(
    state,
    index,
    command,
    `uses ${target.omittedDetail.join(", ")}; imported the main target and omitted that detail`,
  );
}

function targetValidation(target: TargetText, visible: boolean, states: string[] = []): string {
  const suffix = visible ? `is visible` : `is not visible`;
  return `${capitalizeThe(target.visibleSubject)} ${suffix}${states.length ? ` and ${states.join(" and ")}` : ""}`;
}

function assertionStates(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const states: string[] = [];
  for (const [key, word] of [
    ["enabled", "enabled"],
    ["checked", "checked"],
    ["focused", "focused"],
    ["selected", "selected"],
  ] as const) {
    if (typeof value[key] === "boolean") {
      states.push(value[key] === true ? `is ${word}` : `is not ${word}`);
    }
  }
  return states;
}

function tapLike(
  command: MaestroCommand,
  state: ConversionState,
  verb: "Tap" | "Long press",
): ImportedStep[] {
  const target = targetText(command.value, state);
  if (!target) {
    warn(
      state,
      command.index,
      command.name,
      "the target is not text or an identifier Relay can describe",
    );
    return [];
  }
  warnOmittedTargetDetail(state, command.index, command.name, target);
  let times = "";
  if (isRecord(command.value)) {
    const repeat = command.value.repeat;
    if (typeof repeat === "number" && Number.isInteger(repeat) && repeat > 1 && repeat <= 20) {
      times = ` ${repeat} times`;
    } else if (repeat !== undefined && repeat !== 1) {
      note(state, command.index, command.name, "repeat count detail is not represented");
    }
    for (const key of ["delay", "retryTapIfNoChange", "waitToSettleTimeoutMs"]) {
      if (command.value[key] !== undefined) {
        note(state, command.index, command.name, "timing and retry detail is not represented");
        break;
      }
    }
  }
  return [{ kind: "instruction", intent: `${verb} ${target.actionTarget}${times}` }];
}

function inputText(command: MaestroCommand, state: ConversionState): ImportedStep[] {
  const raw =
    typeof command.value === "string"
      ? command.value
      : isRecord(command.value)
        ? text(command.value.text)
        : undefined;
  if (!raw) {
    warn(state, command.index, command.name, "the text is not a string");
    return [];
  }
  return [{ kind: "instruction", intent: `Type "${environmentText(raw, state)}"` }];
}

function visibleAssertion(
  command: MaestroCommand,
  state: ConversionState,
  visible: boolean,
): ImportedStep[] {
  const represented = visible ? ["enabled", "checked", "focused", "selected"] : [];
  const target = targetText(command.value, state, represented);
  if (!target) {
    warn(
      state,
      command.index,
      command.name,
      "the target is not text or an identifier Relay can describe",
    );
    return [];
  }
  warnOmittedTargetDetail(state, command.index, command.name, target);
  return [
    {
      kind: "validation",
      intent: targetValidation(target, visible, visible ? assertionStates(command.value) : []),
    },
  ];
}

function swipe(command: MaestroCommand, state: ConversionState): ImportedStep[] {
  const directionValue =
    typeof command.value === "string"
      ? command.value
      : isRecord(command.value)
        ? command.value.direction
        : undefined;
  const direction = typeof directionValue === "string" ? directionValue.toLowerCase() : "";
  if (!["up", "down", "left", "right"].includes(direction)) {
    warn(
      state,
      command.index,
      command.name,
      "coordinate swipes do not have a plain-English equivalent",
    );
    return [];
  }
  if (isRecord(command.value) && command.value.from !== undefined) {
    const from = targetText(command.value.from, state);
    if (!from) {
      warn(state, command.index, command.name, "its starting point is not text or an identifier");
      return [];
    }
    warnOmittedTargetDetail(state, command.index, command.name, from);
    return [{ kind: "instruction", intent: `Swipe ${direction} from ${from.actionTarget}` }];
  }
  if (
    isRecord(command.value) &&
    (command.value.start !== undefined || command.value.end !== undefined)
  ) {
    warn(
      state,
      command.index,
      command.name,
      "coordinate swipes do not have a plain-English equivalent",
    );
    return [];
  }
  return [{ kind: "instruction", intent: `Swipe ${direction}` }];
}

function launchApp(
  command: MaestroCommand,
  state: ConversionState,
  config: MaestroConfig,
): ImportedStep[] {
  if (command.value === undefined || command.value === null) return [];
  if (typeof command.value === "string") {
    if (!config.appId || command.value === config.appId) return [];
    warn(state, command.index, command.name, "opening a different app is not represented");
    return [];
  }
  if (!isRecord(command.value)) {
    warn(state, command.index, command.name, "its arguments are not represented");
    return [];
  }
  const complex = Object.keys(command.value).filter((key) => key !== "appId");
  if (complex.length) {
    warn(
      state,
      command.index,
      command.name,
      "clear-state, permission, launch-argument, and stop behavior are not represented",
    );
    return [];
  }
  const appId = text(command.value.appId);
  if (appId && config.appId && appId !== config.appId) {
    warn(state, command.index, command.name, "opening a different app is not represented");
  }
  return [];
}

function conditionText(value: unknown, state: ConversionState): string {
  if (typeof value === "string" && value.trim()) {
    return `the condition ${compactCode(value, 80)} is true`;
  }
  if (!isRecord(value)) return "the condition is true";
  if (value.notVisible !== undefined) {
    const target = targetText(value.notVisible, state);
    if (target) return `${target.visibleSubject} is not visible`;
  }
  if (value.visible !== undefined) {
    const target = targetText(value.visible, state);
    if (target) return `${target.visibleSubject} is visible`;
  }
  if (value.text !== undefined) {
    const target = targetText(value.text, state);
    if (target) return `${target.visibleSubject} is visible`;
  }
  return "the condition is true";
}

function describeNestedSteps(steps: readonly ImportedStep[]): string {
  return steps
    .map((step) =>
      step.kind === "validation"
        ? `validate that ${step.intent.charAt(0).toLowerCase()}${step.intent.slice(1)}`
        : step.intent,
    )
    .join("; ");
}

function repeat(
  command: MaestroCommand,
  state: ConversionState,
  config: MaestroConfig,
  depth: number,
): ImportedStep[] {
  if (!isRecord(command.value) || !Array.isArray(command.value.commands)) {
    warn(state, command.index, command.name, "its commands are missing");
    return [];
  }
  const nested = convertCommands(command.value.commands, state, config, depth + 1);
  if (!nested.length) {
    warn(state, command.index, command.name, "none of its commands could be imported");
    return [];
  }
  const timesRaw = command.value.times;
  const times =
    typeof timesRaw === "number" && Number.isInteger(timesRaw) && timesRaw > 0
      ? timesRaw
      : typeof timesRaw === "string" && /^\d+$/u.test(timesRaw)
        ? Number(timesRaw)
        : undefined;
  const whileValue = command.value.while;
  if (times && whileValue === undefined && times <= 20 && nested.length * times <= 80) {
    return Array.from({ length: times }, () => nested).flat();
  }
  const summary = describeNestedSteps(nested);
  let intent: string;
  if (whileValue !== undefined) {
    const condition = conditionText(whileValue, state);
    intent = times
      ? `Repeat these steps up to ${times} times while ${condition}: ${summary}`
      : `Repeat these steps while ${condition}: ${summary}`;
  } else if (times) {
    intent = `Repeat these steps ${times} times: ${summary}`;
  } else {
    warn(state, command.index, command.name, "it has neither a count nor a condition");
    return [];
  }
  note(
    state,
    command.index,
    command.name,
    "was rewritten as one plain-English instruction; review the repetition before running",
  );
  return [{ kind: "instruction", intent }];
}

function runFlow(
  command: MaestroCommand,
  state: ConversionState,
  config: MaestroConfig,
  depth: number,
): ImportedStep[] {
  if (isRecord(command.value) && Array.isArray(command.value.commands)) {
    if (command.value.file !== undefined) {
      warn(state, command.index, command.name, "a file flow cannot also be inline");
      return [];
    }
    const omitted = Object.keys(command.value).filter(
      (key) => !["commands", "label"].includes(key),
    );
    if (omitted.length) {
      note(
        state,
        command.index,
        command.name,
        `uses ${omitted.join(", ")}; imported the inline commands and omitted that detail`,
      );
    }
    return convertCommands(command.value.commands, state, config, depth + 1);
  }
  warn(state, command.index, command.name, "separate flow files are not inlined");
  return [];
}

function simpleUnsupported(command: MaestroCommand): string | undefined {
  if (command.name === "runScript" || command.name === "evalScript") {
    return "scripts are not represented in Relay test files";
  }
  if (command.name === "waitForAnimationToEnd") {
    return "timing-only waits are not represented in Relay test files";
  }
  if (command.name === "copyTextFrom" || command.name === "pasteText") {
    return "clipboard state is not represented in Relay test files";
  }
  if (command.name === "extendedWaitUntil") {
    return "timing-only waits are not represented in Relay test files";
  }
  return undefined;
}

function convertOne(
  command: MaestroCommand,
  state: ConversionState,
  config: MaestroConfig,
  depth: number,
): ImportedStep[] {
  if (depth > 6) {
    warn(state, command.index, command.name, "the flow nesting is too deep");
    return [];
  }
  switch (command.name) {
    case "tapOn":
      return tapLike(command, state, "Tap");
    case "longPressOn":
      return tapLike(command, state, "Long press");
    case "inputText":
      return inputText(command, state);
    case "assertVisible":
      return visibleAssertion(command, state, true);
    case "assertNotVisible":
      return visibleAssertion(command, state, false);
    case "swipe":
      return swipe(command, state);
    case "scroll":
      return [{ kind: "instruction", intent: "Swipe up to see more content" }];
    case "back":
      return [{ kind: "instruction", intent: "Go back" }];
    case "pressKey": {
      const key = typeof command.value === "string" ? command.value.trim() : "";
      if (!key) {
        warn(state, command.index, command.name, "the key is not a string");
        return [];
      }
      return [{ kind: "instruction", intent: `Press ${key}` }];
    }
    case "hideKeyboard":
      return [{ kind: "instruction", intent: "Hide the keyboard" }];
    case "eraseText":
      return [{ kind: "instruction", intent: "Clear the current text field" }];
    case "openLink": {
      const link =
        typeof command.value === "string"
          ? command.value
          : isRecord(command.value)
            ? text(command.value.link)
            : undefined;
      if (!link) {
        warn(state, command.index, command.name, "the link is not a string");
        return [];
      }
      return [{ kind: "instruction", intent: `Open ${link}` }];
    }
    case "launchApp":
      return launchApp(command, state, config);
    case "runFlow":
      return runFlow(command, state, config, depth);
    case "repeat":
      return repeat(command, state, config, depth);
    default: {
      const known = simpleUnsupported(command);
      warn(state, command.index, command.name, known ?? "no plain-English equivalent was imported");
      return [];
    }
  }
}

function normalizeCommand(raw: unknown, index: number): MaestroCommand {
  if (typeof raw === "string") return { name: raw, value: undefined, index, raw };
  if (isRecord(raw)) {
    const entries = Object.entries(raw);
    if (entries.length === 1) {
      const [name, value] = entries[0]!;
      return { name, value, index, raw };
    }
  }
  return { name: "unrecognized command", value: raw, index, raw };
}

function convertCommands(
  raws: readonly unknown[],
  state: ConversionState,
  config: MaestroConfig,
  depth: number,
): ImportedStep[] {
  return raws.flatMap((raw, index) =>
    convertOne(normalizeCommand(raw, index + 1), state, config, depth),
  );
}

function maestroDocuments(
  source: string,
  sourceName: string,
): {
  config: MaestroConfig;
  commands: unknown[];
} {
  let documents;
  try {
    documents = [...parseAllDocuments(source, { prettyErrors: true })];
  } catch (error) {
    throw new UsageError(
      `${sourceName}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const firstError = documents.flatMap((document) => document.errors)[0];
  if (firstError) throw new UsageError(`${sourceName}: invalid YAML: ${firstError.message}`);
  const values = documents.map((document) => document.toJS() as unknown);
  if (values.length === 1 && Array.isArray(values[0])) {
    return { config: {}, commands: values[0] };
  }
  if (values.length === 1 && isRecord(values[0]) && Array.isArray(values[0].commands)) {
    const config = { ...values[0] };
    delete config.commands;
    return { config: config as MaestroConfig, commands: values[0].commands as unknown[] };
  }
  if (values.length >= 2 && isRecord(values[0]) && Array.isArray(values[1])) {
    return { config: values[0] as MaestroConfig, commands: values[1] };
  }
  throw new UsageError(
    `${sourceName}: no Maestro command list found. Expected config, ---, then a list of commands.`,
  );
}

function targetFromConfig(
  config: MaestroConfig,
  overrides: ImportOverrides,
  state: ConversionState,
  sourceName: string,
): { app?: string; url?: string } {
  let url = text(config.url);
  if (url && !/^https?:\/\/\S+$/iu.test(url)) {
    state.warnings.push(
      `the Maestro url ${compactCode(url, 80)} is not http(s) and was not copied`,
    );
    url = undefined;
  }
  if (overrides.url) {
    if (!/^https?:\/\/\S+$/iu.test(overrides.url)) {
      throw new UsageError(`${sourceName}: input url must start with http:// or https://`);
    }
    url = overrides.url;
  }
  let app: string | undefined;
  if (overrides.app) app = overrides.app;
  else if (!url && text(config.appId)) {
    app = text(config.appId);
    state.warnings.push(
      `appId ${app} was copied to app; confirm that a Relay App uses that name or id`,
    );
  }
  if (!app && !url) {
    throw new UsageError(
      `${sourceName}: no target was found. Maestro needs url or appId, or pass app/url in --input.`,
    );
  }
  return { ...(app ? { app } : {}), ...(url ? { url } : {}) };
}

/** Convert one Maestro flow document to one Relay YAML test. */
export function convertMaestroFlow(input: {
  source: string;
  sourceName: string;
  fileName: string;
  overrides?: ImportOverrides;
}): ConvertedImportTest {
  const { config, commands } = maestroDocuments(input.source, input.sourceName);
  const state: ConversionState = { warnings: [], environmentNote: false };
  const steps = convertCommands(commands, state, config, 0);
  const target = targetFromConfig(config, input.overrides ?? {}, state, input.sourceName);
  const name =
    input.overrides?.name?.trim() || text(config.name) || humanizeFileStem(input.fileName);
  const warnings = uniqueWarnings(state.warnings);
  const yaml = renderRelayTestYaml({
    name,
    ...target,
    steps,
    comments: importComments("maestro", input.sourceName, warnings),
  });
  return {
    sourceName: input.sourceName,
    outputFileName: `${kebabFileStem(input.fileName)}.yaml`,
    name,
    yaml,
    warnings,
    stepCount: steps.length,
  };
}
