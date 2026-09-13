import { commandPath as path } from "./command-descriptors.js";

export const planRunCommandPath = path(
  "plan run",
  ["appMapId", "combineId"],
  { executionMode: "all" },
  {
    summary: "Run every case of a saved Plan",
    argumentHelp: [
      { name: "appMapId", type: "string", description: "App Map identifier" },
      { name: "combineId", type: "string", description: "Saved Plan (Combine identifier)" },
    ],
    examples: [
      'relay plan run grok-web grok-web-daily --budget 3m --findings --input \'{"browserTargetId":"grok-com","targetKind":"browser"}\'',
    ],
    note: "Plans default to every selected case. --budget 3m is a run/watch budget, not a promise the pack finishes. --findings prints markdown after the wait; Confirm/Reject never auto-accept visual baselines.",
    behavior: "job-start-watch",
  },
);

export const planFindingsCommandPath = path("plan findings", ["batchId"], undefined, {
  summary: "Print Plan findings as markdown for Confirm/Reject",
  argumentHelp: [{ name: "batchId", type: "string", description: "Plan / Combine campaign ID" }],
  note: "Confirm and Reject never accept a visual baseline. Use relay run visual review for that.",
});
