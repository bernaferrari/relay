import { commandPath as path } from "./command-descriptors.js";

export const planListCommandPath = path("plan list", ["appMapId"], undefined, {
  summary: "List saved Plans for an App",
  argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
  examples: ["relay plan list shop-ios --json"],
});

export const planGetCommandPath = path("plan get", ["appMapId", "combineId"], undefined, {
  summary: "Inspect one saved Plan's Tests, Data sets, and setup bindings",
  argumentHelp: [
    { name: "appMapId", type: "string", description: "App Map identifier" },
    { name: "planId", type: "string", description: "Saved Plan identifier" },
  ],
  examples: ["relay plan get shop-ios prompt-checks --json"],
  note: "Reads the exact saved Combine definition without starting a Run or checking a device.",
});

export const planPreflightCommandPath = path(
  "plan preflight",
  ["appMapId", "combineId"],
  undefined,
  {
    summary: "Check a saved Plan's cases and blockers without starting",
    argumentHelp: [
      { name: "appMapId", type: "string", description: "App Map identifier" },
      { name: "planId", type: "string", description: "Saved Plan identifier" },
    ],
    inputHelp: [
      { name: "serial", type: "string", description: "Optional connected device to verify" },
      { name: "targetKind", type: "device | browser", description: "Execution target kind" },
      { name: "browserTargetId", type: "string", description: "Managed browser target identifier" },
      { name: "targetProfileId", type: "string", description: "Exact saved evidence profile" },
      {
        name: "profileTargets",
        type: "array",
        description: "Optional selected device or browser setups",
      },
    ],
    examples: [
      "relay plan preflight shop-ios prompt-checks --json",
      'relay plan preflight shop-ios prompt-checks --input \'{"serial":"<device>","targetProfileId":"<saved-profile>"}\' --json',
      'relay plan preflight shop-web daily-checks --input \'{"browserTargetId":"shop-browser","targetKind":"browser"}\'',
    ],
    note: "Uses the existing Combine preflight. Saved selection is not proof that its device or browser is ready.",
  },
);

export const planRunCommandPath = path(
  "plan run",
  ["appMapId", "combineId"],
  { executionMode: "pilot" },
  {
    summary: "Run one case of a saved Plan",
    argumentHelp: [
      { name: "appMapId", type: "string", description: "App Map identifier" },
      { name: "planId", type: "string", description: "Saved Plan identifier" },
    ],
    examples: [
      "relay plan run shop-web daily-checks --lane daily --budget 10m --findings",
      "relay plan run shop-web daily-checks --lane daily --all --budget 10m --findings",
      "relay plan run shop-web judged-checks --lane daily --all --budget 10m --findings",
      "relay plan run shop-web hourly --lane lab --all --export /tmp/hourly --todo ./todo.json --findings",
    ],
    inputHelp: [
      {
        name: "triage",
        type: '"jev"',
        description: "Optional read-only OpenRouter sorting of saved findings for human review.",
      },
      {
        name: "serial",
        type: "string",
        description:
          "Legacy one-target device serial. Omit it when cellTargetBindings is supplied; Relay will not infer a local target.",
      },
      {
        name: "platform",
        type: "android | ios",
        description:
          "Required with the legacy serial path. Each explicit local target binding carries its own platform.",
      },
      {
        name: "selected",
        type: "object",
        description:
          'Optional value ids selected per Variable, for example {"language":["it"]} to run Italian only',
      },
      {
        name: "strategy",
        type: "zip | cartesian | pairwise",
        description: "Value coverage strategy",
      },
      {
        name: "executionMode",
        type: "pilot | all",
        description: "Pilot is the default. Pass --all to run every selected world.",
      },
      {
        name: "cellRuntimeProfiles",
        type: "array",
        description:
          "Explicit {testId, values, targetProfileId} bindings for every selected Test × world cell",
      },
      {
        name: "cellTargetBindings",
        type: "array",
        description:
          "Explicit [{testId, values, target}] local execution targets for every selected cell. A target is a versioned local-device Android/iOS reference; provider sessions are not capacity.",
      },
      {
        name: "localAdmission",
        type: "object",
        description:
          "Shared LocalCampaignAdmissionRequest: {deadlineMs, durationEvidence, setupHeadroomMs?, recoveryHeadroomMs?}. Evidence must be fresh observed p50/p95 data for every bound target × Test/action cohort.",
      },
      {
        name: "selectedCellIds",
        type: "array",
        description: "Optional subset of cell IDs to queue after offline preparation",
      },
      {
        name: "cell",
        type: "string",
        description: "World selector such as ja. Default without --all is one cell.",
      },
    ],
    note: "One case is the default. Pass --all to run every selected case. --lane fills browser target, profile, and account overlay so --input-file is not needed. --budget 10m is a watch timeout, not a pack-duration promise. --budget 3m is too tight for the eight-Test logged-out pack. --findings prints markdown after the wait. --export writes the review pack with a Test checklist; optional --todo merges unbound/gated rows. A default serial/target fills missing cell bindings; per-cell cellRuntimeProfiles and cellTargetBindings remain overrides; a local multi-target campaign passes cellTargetBindings plus the shared localAdmission object. Confirm/Reject never auto-accept visual baselines — use relay run visual review <job>. If watch dies with fetch failed, tsx watch likely restarted :8787 and dropped in-memory jobs — do not recover-kill a live iOS runner, and do not edit core/server while a Plan is live.",
    behavior: "job-start-watch",
  },
);

export const planFindingsCommandPath = path("plan findings", ["batchId"], undefined, {
  summary: "Print Plan findings as markdown for Confirm/Reject",
  argumentHelp: [{ name: "batchId", type: "string", description: "Plan campaign ID" }],
  inputHelp: [
    {
      name: "triage",
      type: '"jev"',
      description: "Optional read-only OpenRouter sorting of saved findings for human review.",
    },
  ],
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
  note: "Planned, captured, blocked, missing, pending, accepted, and issue counts. Filters change the working set, not the denominator. Blocked is not missing. Accept as reference explicitly governs later Runs.",
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
        type: '"accept" | "accept-as-reference" | "report-issue" | "need-more-evidence"',
        required: true,
        description:
          "Looks correct reviews this capture; accept-as-reference also governs later Runs. Or report an issue or ask for more evidence.",
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
    note: "Accept as reference explicitly governs later Runs. Bulk review binds only the listed items that match any pending/screen/device/account filter.",
  },
);
