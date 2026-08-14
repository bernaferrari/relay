import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";
import { graphTestCommandDescriptors } from "./test-commands.js";

/** State sets, graph Tests, run matrices, and direct flow execution. */
export const appMapRunPlanCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped(
    "app-map.variable.save",
    path("state-set save", ["appMapId", "variableId"], undefined, {
      summary: "Save a reusable device state set (language, account, theme, …)",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "variableId", type: "string", description: "Stable state set identifier" },
      ],
      inputHelp: [
        { name: "expectedRevision", type: "number", description: "Current App Map revision" },
        {
          name: "variable",
          type: "object",
          description: "Name, kind, values, and the recorded path that opens the value list",
        },
      ],
      examples: [
        `relay state-set save settings language --input '${JSON.stringify({
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
      ],
      note: "A state set changes one reusable dimension. A run matrix combines one or more state sets with one or more tests.",
    }),
    path("variable save", ["appMapId", "variableId"], undefined, {
      summary: "Legacy alias of state-set save",
    }),
    path("option-set save", ["appMapId", "variableId"], undefined, {
      summary: "Alias of variable save",
    }),
  ),
  mapped(
    "app-map.variable.remove",
    path("state-set remove", ["appMapId", "variableId"]),
    path("variable remove", ["appMapId", "variableId"]),
    path("option-set remove", ["appMapId", "variableId"]),
  ),
  ...graphTestCommandDescriptors,
  mapped(
    "app-map.combine.preflight",
    path("run-matrix preflight", ["appMapId", "combineId"], undefined, {
      summary: "Preview expansion, evidence, duration, and blockers without starting",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "combineId", type: "string", description: "Saved run matrix" },
      ],
      inputHelp: [
        { name: "serial", type: "string", description: "Optional connected device to verify" },
      ],
      examples: [
        "relay run-matrix preflight grok-android language-x-settings",
        'relay run-matrix preflight grok-android language-x-settings --input \'{"serial":"DEVICE"}\'',
      ],
    }),
    path("run-matrix dry-run", ["appMapId", "combineId"], undefined, {
      summary: "Alias of run-matrix preflight",
    }),
  ),
  mapped(
    "app-map.combine.save",
    path("run-matrix save", ["appMapId", "combineId"], undefined, {
      summary: "Save selected state sets × selected tests",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "combineId", type: "string", description: "Stable run matrix identifier" },
      ],
      inputHelp: [
        { name: "expectedRevision", type: "number", description: "Current App Map revision" },
        {
          name: "combine",
          type: "object",
          description: "Matrix name plus state-set ids and test ids",
        },
      ],
      examples: [
        `relay run-matrix save settings language-x-tour --input '${JSON.stringify({
          expectedRevision: 5,
          combine: {
            name: "Language × Settings tour",
            variableIds: ["language"],
            testIds: ["settings-tour"],
            strategy: "cartesian",
          },
        })}'`,
      ],
      note: "Each cell applies one value from every state set, then runs every selected test.",
    }),
    path("combine save", ["appMapId", "combineId"], undefined, {
      summary: "Legacy alias of run-matrix save",
    }),
    path("combo save", ["appMapId", "combineId"]),
  ),
  mapped(
    "app-map.combine.remove",
    path("run-matrix remove", ["appMapId", "combineId"]),
    path("combine remove", ["appMapId", "combineId"]),
    path("combo remove", ["appMapId", "combineId"]),
  ),
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
