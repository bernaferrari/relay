import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";
import { graphTestCommandDescriptors } from "./test-commands.js";

/** Variables, graph Tests, Combines, and direct flow execution. */
export const appMapRunPlanCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped(
    "app-map.variable.save",
    path("variable save", ["appMapId", "variableId"], undefined, {
      summary: "Save a reusable Variable for Test inputs or app settings",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "variableId", type: "string", description: "Stable Variable identifier" },
      ],
      inputHelp: [
        { name: "expectedRevision", type: "number", description: "Current App Map revision" },
        {
          name: "variable",
          type: "object",
          description:
            "Name, kind, values, and an explicit Project input reference or reviewed app-setting actions",
        },
      ],
      examples: [
        `relay variable save grok-android questions --input '${JSON.stringify({
          expectedRevision: 4,
          variable: {
            name: "Chat prompts",
            kind: "custom",
            apply: { kind: "input", inputId: "chat-prompt-data" },
            options: [
              { id: "value-1", label: "Tides", value: "Explain ocean tides in three sentences" },
              { id: "value-2", label: "Paper plane", value: "Suggest one paper airplane tip" },
            ],
          },
        })}'`,
        `relay variable save settings language --input '${JSON.stringify({
          expectedRevision: 4,
          variable: {
            name: "Language",
            kind: "language",
            apply: {
              kind: "list",
              entryPath: [{ kind: "tap", target: { label: "App Language" } }],
            },
            options: [
              { id: "en", label: "English" },
              { id: "it", label: "Italiano" },
            ],
          },
        })}'`,
        `relay variable save grok-android language --input '${JSON.stringify({
          expectedRevision: 4,
          variable: {
            name: "Language",
            kind: "language",
            apply: { kind: "appLocale", app: "ai.x.grok" },
            options: [
              { id: "en", label: "English" },
              { id: "ja", label: "日本語" },
            ],
          },
        })}'`,
      ],
      note: "An input Variable references a stable Project Data set ID. Its rows carry approved shared, non-sensitive list/static values in value, separately from bounded row IDs and display labels. Each Test consumes only its referenced inputs, without picker actions. Values are frozen when admitted and retained during resume. A Combine selects Variables and Tests; zip pairs rows in order. appLocale Variables stay when the compiled Test has an expect-screen; they relaunch if stay cannot be proved. apply.relaunch: true still relaunches.",
    }),
  ),
  mapped("app-map.variable.remove", path("variable remove", ["appMapId", "variableId"])),
  ...graphTestCommandDescriptors,
  mapped(
    "app-map.combine.preflight",
    path("combine preflight", ["appMapId", "combineId"], undefined, {
      summary: "Preview expansion, evidence, duration, and blockers without starting",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "combineId", type: "string", description: "Saved Combine" },
      ],
      inputHelp: [
        { name: "serial", type: "string", description: "Optional connected device to verify" },
        {
          name: "targetProfileId",
          type: "string",
          description:
            "Saved evidence profile, or ios/android to follow a linked grok-ios / grok-android companion",
        },
        {
          name: "profileTargets",
          type: "array",
          description:
            "Optional browser account lanes. Parallel wall-clock is quoted from observed pack duration when these are fixture-keyed.",
        },
      ],
      examples: [
        "relay combine preflight grok-android language-x-settings",
        'relay combine preflight grok-android language-x-settings --input \'{"serial":"DEVICE"}\'',
        'relay combine preflight grok-web grok-web-daily --input \'{"browserTargetId":"grok-com","targetKind":"browser"}\'',
        'relay combine preflight grok-web grok-web-daily --input \'{"browserTargetId":"grok-com","targetProfileId":"android"}\'',
      ],
    }),
  ),
  mapped(
    "app-map.combine.save",
    path("combine save", ["appMapId", "combineId"], undefined, {
      summary: "Save selected Variables × selected Tests",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "combineId", type: "string", description: "Stable Combine identifier" },
      ],
      inputHelp: [
        { name: "expectedRevision", type: "number", description: "Current App Map revision" },
        {
          name: "combine",
          type: "object",
          description: "Combine name plus Variable ids and Test ids",
        },
      ],
      examples: [
        `relay combine save settings language-x-coverage --input '${JSON.stringify({
          expectedRevision: 5,
          combine: {
            name: "Language × Settings coverage",
            variableIds: ["language"],
            testIds: ["settings-coverage"],
            strategy: "cartesian",
          },
        })}'`,
      ],
      note: "Each cell applies one value from every Variable, then runs every selected Test. Use strategy: zip to pair equally sized prompt lists in order; input dimensions that a Test does not reference remain in its case identity without changing its actions.",
    }),
  ),
  mapped("app-map.combine.remove", path("combine remove", ["appMapId", "combineId"])),
  mapped(
    "app-map.flow.run",
    path("flow run", ["appMapId", "flowId"], undefined, {
      summary: "Run a saved App Map flow",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "flowId", type: "string", description: "Saved flow identifier" },
      ],
      inputHelp: [
        { name: "serial", type: "string", description: "Device serial" },
        { name: "platform", type: "android | ios", description: "Device platform" },
        {
          name: "targetKind",
          type: "device | browser",
          description: "Execution target kind; defaults to device",
        },
        {
          name: "browserTargetId",
          type: "string",
          description: "Managed browser target identifier when targetKind is browser",
        },
        {
          name: "variables",
          type: "object",
          description: "Flow variables; values may be strings or arrays for case coverage",
        },
      ],
      examples: [
        'relay flow run checkout main --input \'{"serial":"<phone-serial>","platform":"android"}\'',
        'relay flow run checkout main --input \'{"serial":"<phone-serial>","variables":{"model":["low","medium","high"]}}\'',
      ],
      behavior: "job-start-watch",
    }),
  ),
];
