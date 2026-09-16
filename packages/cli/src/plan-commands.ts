import { commandPath as path } from "./command-descriptors.js";

export const planRunCommandPath = path(
  "plan run",
  ["appMapId", "combineId"],
  { executionMode: "all" },
  {
    summary: "Run every case of a saved Plan",
    argumentHelp: [
      { name: "appMapId", type: "string", description: "App Map identifier" },
      { name: "combineId", type: "string", description: "Saved Plan identifier" },
    ],
    examples: [
      "relay plan run grok-web grok-web-daily --lane grok-daily --budget 10m --findings",
      "relay plan run grok-web grok-web-judged --lane grok-daily --budget 10m --findings",
      "relay plan run grok-web grok-hourly --lane grok-lab --export /tmp/hourly --todo ./todo.json --findings",
    ],
    note: "Plans default to every selected case. --lane fills browser target, profile, and account overlay so --input-file is not needed. --budget 10m is a watch timeout, not a pack-duration promise. --budget 3m is too tight for the eight-Test logged-out pack. --findings prints markdown after the wait. --export writes the review pack with a Test checklist; optional --todo merges unbound/gated rows. Confirm/Reject never auto-accept visual baselines — use relay run visual review <job>. If watch dies with fetch failed, tsx watch likely restarted :8787 and dropped in-memory jobs — do not recover-kill a live iOS runner, and do not edit core/server while a Plan is live.",
    behavior: "job-start-watch",
  },
);

export const planFindingsCommandPath = path("plan findings", ["batchId"], undefined, {
  summary: "Print Plan findings as markdown for Confirm/Reject",
  argumentHelp: [{ name: "batchId", type: "string", description: "Plan campaign ID" }],
  note: "Confirm and Reject never accept a visual baseline. Use relay run visual review for that.",
});

export const planCaptureReviewCommandPath = path("plan capture review", ["batchId"], undefined, {
  summary: "List screenshot review across one Plan",
  argumentHelp: [{ name: "batchId", type: "string", description: "Plan campaign ID" }],
  inputHelp: [
    {
      name: "pending",
      type: "boolean",
      description: "Only pending review items. Coverage counts stay on the full Plan.",
    },
    {
      name: "screen",
      type: "string",
      description: "Filter by caption or checkpoint. Hidden items cannot be bulk-accepted.",
    },
    {
      name: "device",
      type: "string",
      description: "Filter by device serial, app, or browser. Use --input, not --device.",
    },
    {
      name: "account",
      type: "string",
      description: "Filter by account label.",
    },
  ],
  examples: [
    "relay plan capture review <batch-id>",
    'relay plan capture review <batch-id> --input \'{"pending":true,"screen":"Settings","account":"Member"}\'',
  ],
  note: "Planned, captured, blocked, pending, accepted, and issue counts. Filters change the working set, not the denominator. Missing stays in the denominator. Looks correct does not approve a visual baseline.",
});

export const planCaptureReviewApplyCommandPath = path(
  "plan capture review apply",
  ["batchId"],
  undefined,
  {
    summary: "Record human decisions on exact selected Plan screenshots",
    argumentHelp: [{ name: "batchId", type: "string", description: "Plan campaign ID" }],
    inputHelp: [
      {
        name: "action",
        type: '"accept" | "report-issue" | "need-more-evidence"',
        required: true,
        description: "Looks correct, report an issue, or ask for more evidence. Never a baseline.",
      },
      {
        name: "items",
        type: "array",
        required: true,
        description: "Exact runId, captureId, and imageSha256 list. Never future arrivals.",
      },
      {
        name: "pending",
        type: "boolean",
        description: "Optional. Hidden items in this working set cannot be accepted.",
      },
      {
        name: "screen",
        type: "string",
        description: "Optional. Restrict Looks correct to this caption or checkpoint.",
      },
      {
        name: "device",
        type: "string",
        description: "Optional. Restrict Looks correct to this device. Use --input, not --device.",
      },
      {
        name: "account",
        type: "string",
        description: "Optional. Restrict Looks correct to this account.",
      },
    ],
    examples: [
      'relay plan capture review apply <batch-id> --input \'{"action":"accept","items":[{"runId":"run-1","captureId":"frames/001.png::abc","imageSha256":"abc"}]}\' --actor human:local-cli --confirm',
    ],
    note: "Looks correct does not approve a visual baseline. Bulk accept binds only the listed items that match any pending/screen/device/account filter.",
  },
);
