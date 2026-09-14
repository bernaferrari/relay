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
      "relay plan run grok-web grok-web-daily --lane grok-daily --budget 10m --findings",
      "relay plan run grok-web grok-web-judged --lane grok-daily --budget 10m --findings",
      "relay plan run grok-web grok-hourly --lane grok-lab --export /tmp/hourly --todo ./todo.json --findings",
    ],
    note: "Plans default to every selected case. --lane fills browser target, profile, and account overlay so --input-file is not needed. --budget 10m is a watch timeout, not a pack-duration promise. --budget 3m is too tight for the eight-Test logged-out pack. --findings prints markdown after the wait. --export writes the Combine pack with a Test checklist; optional --todo merges unbound/gated rows. Confirm/Reject never auto-accept visual baselines — use relay run visual review <job>.",
    behavior: "job-start-watch",
  },
);

export const planFindingsCommandPath = path("plan findings", ["batchId"], undefined, {
  summary: "Print Plan findings as markdown for Confirm/Reject",
  argumentHelp: [{ name: "batchId", type: "string", description: "Plan / Combine campaign ID" }],
  note: "Confirm and Reject never accept a visual baseline. Use relay run visual review for that.",
});
