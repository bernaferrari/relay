import {
  appMapAuthoringCommandDescriptors,
  appMapRoutineCommandDescriptors,
} from "./app-map-commands.js";
import { appMapRunPlanCommandDescriptors } from "./app-map-run-plan-commands.js";
import { authoringSessionCommandDescriptors } from "./authoring-session-commands.js";
import { campaignCapacityCommandDescriptors } from "./campaign-capacity-commands.js";
import {
  commandPath as path,
  mappedOperation as mapped,
  type CliOperationDescriptor,
} from "./command-descriptors.js";
import {
  planCaptureReviewApplyCommandPath,
  planCaptureReviewCommandPath,
  planFindingsCommandPath,
  planRunCommandPath,
} from "./plan-commands.js";
import { runEvidenceCommandDescriptors } from "./run-share-commands.js";
import { proofCommandDescriptors } from "./proof-commands.js";
import { targetCommandDescriptors } from "./target-commands.js";
import { laneCommandDescriptors } from "./lane-commands.js";

export const cliOperationDescriptors: readonly CliOperationDescriptor[] = [
  mapped("system.health.get", path("system health")),
  mapped("system.doctor.get", path("system doctor")),
  mapped(
    "system.audit.list",
    path("activity audit", [], undefined, {
      summary: "List operation audit records",
    }),
  ),
  mapped(
    "event.stream",
    path("activity follow", [], undefined, {
      summary: "Follow live project activity",
      examples: ["relay activity follow --ndjson"],
      behavior: "event-stream",
    }),
  ),
  mapped(
    "activity.export",
    path("activity export", [], undefined, {
      summary: "Export the complete attributed project activity log",
      examples: ["relay activity export --json > relay-activity.json"],
    }),
  ),
  {
    operationId: "activity.list",
    exclusion: "internal",
    reason: "Activity list uses the CLI's bounded, cursor-aware read-only resource router.",
  },
  {
    operationId: "target.stream.open",
    exclusion: "internal",
    reason: "Live target video is a media stream, not a CLI command.",
  },
  {
    operationId: "target.observation.capture",
    exclusion: "internal",
    reason: "The public relay observe outcome owns durable bounded target observation.",
  },
  {
    operationId: "target.browser-device.open",
    exclusion: "internal",
    reason: "The in-app Browser Device owns its renderer session lifecycle.",
  },
  {
    operationId: "target.browser-device.frame",
    exclusion: "internal",
    reason: "Browser Device frames are renderer media transport, not a CLI command.",
  },
  {
    operationId: "target.browser-device.frame-binary",
    exclusion: "internal",
    reason: "Browser Device binary frames are renderer media transport, not a CLI command.",
  },
  {
    operationId: "target.browser-device.inspect",
    exclusion: "internal",
    reason:
      "Browser Device semantic overlays are renderer-bound frame inspection, not a CLI command.",
  },
  {
    operationId: "target.browser-device.control",
    exclusion: "internal",
    reason: "Browser Device input must stay bound to the renderer's painted frame.",
  },
  {
    operationId: "workflow.create",
    exclusion: "internal",
    reason: "Outcome commands reserve durable workflows without exposing protocol mechanics.",
  },
  {
    operationId: "workflow.get",
    exclusion: "internal",
    reason: "relay inspect-workflow owns durable workflow inspection.",
  },
  {
    operationId: "workflow.transition",
    exclusion: "internal",
    reason: "Outcome commands own authorized CAS transitions for Runs and recordings.",
  },
  ...laneCommandDescriptors,

  mapped("workspace.privacy.get", path("policy privacy get")),
  mapped("workspace.privacy.update", path("policy privacy update")),
  mapped("workspace.evidence.get", path("policy evidence get")),
  mapped("workspace.evidence.update", path("policy evidence update")),
  mapped("workspace.change.inspect", path("change inspect")),
  mapped("workspace.apple-device.update", path("workspace apple-device update")),
  mapped("workspace.apple-live-preview.update", path("workspace apple-live-preview update")),
  mapped("workspace.variables.get", path("data variables get")),
  mapped("workspace.variables.update", path("data variables update")),

  ...targetCommandDescriptors,

  mapped("project.list", path("project list")),
  mapped("project.save", path("project save")),
  mapped("build.list", path("build list")),
  mapped("build.save", path("build save")),
  mapped("build.preflight", path("build preflight", ["buildId"])),
  mapped("build.install", path("build install", ["buildId", "serial"])),
  mapped("build.launch", path("build launch", ["buildId", "serial"])),
  mapped("device-pool.list", path("device-pool list")),
  mapped("device-pool.save", path("device-pool save")),
  mapped("device-pool.preflight", path("device-pool preflight", ["poolId"])),
  mapped("target-worker.list", path("target worker list")),
  ...campaignCapacityCommandDescriptors,
  ...proofCommandDescriptors,
  mapped(
    "lease.list",
    path(
      "lease list",
      [],
      { status: "active" },
      {
        summary: "List active target leases",
      },
    ),
    path(
      "lease history",
      [],
      { status: "all" },
      {
        summary: "List active and historical target leases",
      },
    ),
  ),
  mapped(
    "lease.create",
    path(
      "lease create",
      ["deviceSerial"],
      { poolId: "local" },
      {
        summary: "Take exclusive control of a local device for 2 hours",
        argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
        inputHelp: [
          {
            name: "expiresAt",
            type: "number",
            description: "Optional Unix time in milliseconds; defaults to 2 hours from now",
          },
        ],
        examples: [
          "relay lease create 00008110 --actor human:bernardo",
          "relay lease create emulator-5554 --actor agent:mapper --json",
        ],
        note: "Use the same --actor for subsequent device input. Read-only observation and screenshots do not require a lease.",
      },
    ),
    path("lease create-in-pool", ["poolId", "deviceSerial"], undefined, {
      summary: "Take exclusive control of a device from a named pool for 2 hours",
      argumentHelp: [
        { name: "pool", type: "string", description: "Device-pool identifier" },
        { name: "serial", type: "string", description: "Connected device serial" },
      ],
      inputHelp: [
        {
          name: "expiresAt",
          type: "number",
          description: "Optional Unix time in milliseconds; defaults to 2 hours from now",
        },
      ],
      examples: ["relay lease create-in-pool cloud-ios iphone-16 --actor agent:mapper"],
    }),
  ),
  mapped(
    "lease.takeover",
    path("lease takeover", ["leaseId"], undefined, {
      summary: "Explicitly take control from an observed active lease",
      argumentHelp: [
        { name: "leaseId", type: "string", description: "Exact active lease to replace" },
      ],
      inputHelp: [
        {
          name: "expiresAt",
          type: "number",
          description: "Optional new lease expiry; defaults to 2 hours from now",
        },
        { name: "reason", type: "string", required: true, description: "Auditable handoff reason" },
        { name: "confirm", type: "true", required: true, description: "Explicit user approval" },
      ],
    }),
  ),
  mapped("lease.release", path("lease release", ["leaseId"])),

  ...appMapAuthoringCommandDescriptors,
  mapped(
    "app-map.variable.infer",
    path("variable infer", ["appMapId", "variableId"], undefined, {
      summary: "Infer remaining Variable rows from 1-8 taught examples",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "variableId", type: "string", description: "Stable Variable identifier" },
      ],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "target",
          type: "object",
          required: true,
          description:
            'Leased control target, e.g. {"kind":"device","platform":"android","targetId":"<serial>"}',
        },
        {
          name: "taughtRows",
          type: "array",
          required: true,
          description:
            "1-8 already-taught option rows ({id, identifier?, label?, text?}) to infer the rest from",
        },
        {
          name: "leaseId",
          type: "string",
          required: true,
          description: "Actor-owned target lease identifier",
        },
        { name: "name", type: "string", description: "Optional Variable display name" },
        {
          name: "kind",
          type: "string",
          description: "Optional Variable kind (language, account, theme, …)",
        },
        {
          name: "apply",
          type: "object",
          description: "Optional reviewed actions that open the value list",
        },
      ],
      examples: [
        `relay variable infer shop-android language --input '${JSON.stringify({
          expectedRevision: 4,
          leaseId: "<lease>",
          target: { kind: "device", platform: "android", targetId: "<serial>" },
          taughtRows: [
            { id: "en", label: "English" },
            { id: "it", label: "Italiano" },
          ],
        })}'`,
      ],
      note: "Requires an active exclusive lease on the target. Taught rows seed inference; the server walks the apply path and reads the remaining options.",
    }),
  ),
  ...appMapRunPlanCommandDescriptors,
  ...appMapRoutineCommandDescriptors,

  ...authoringSessionCommandDescriptors,
  {
    operationId: "authoring.take.edit",
    exclusion: "internal",
    reason: "The Test-first edit-recording outcome owns this canonical typed mutation.",
  },

  mapped("schedule.list", path("schedule list")),
  mapped(
    "schedule.create",
    path("schedule create", [], undefined, {
      summary: "Schedule a saved Plan/Combine or compiled recipe",
      inputHelp: [
        {
          name: "recipeId",
          type: "string",
          description: "Compiled execution-plan identifier; choose this or combineId.",
        },
        {
          name: "combineId",
          type: "string",
          description: "Saved Run Across Plan/Combine identifier; choose this or recipeId.",
        },
        {
          name: "appMapId",
          type: "string",
          description: "Required with combineId; native App Map that owns the saved Combine.",
        },
        {
          name: "targetKind",
          type: '"device" | "browser"',
          required: true,
          description: "Scheduled target type.",
        },
        {
          name: "targetId",
          type: "string",
          required: true,
          description: "Exact connected device serial or browser target identifier.",
        },
        {
          name: "platform",
          type: '"android" | "ios" | "browser"',
          required: true,
          description: "Target platform.",
        },
        {
          name: "intervalMinutes",
          type: "integer (1..43200)",
          required: true,
          description: "Time between schedule runs; use 30 for every 30 minutes.",
        },
        {
          name: "hour",
          type: "integer (0..23)",
          description: "Optional local hour for a daily schedule.",
        },
        {
          name: "timezone",
          type: "string",
          description: "Optional IANA timezone for a daily schedule.",
        },
        {
          name: "repetitions",
          type: "integer (1..20)",
          description:
            "Optional case repetition count for compiled recipe schedules; Combine schedules run their saved cases.",
        },
        {
          name: "enabled",
          type: "boolean",
          description: "Optional enabled state; defaults to enabled.",
        },
        {
          name: "profileTargets",
          type: "array",
          description: "Optional frozen profile-to-target bindings for a multi-profile Combine.",
        },
      ],
      examples: [
        `relay schedule create --input '${JSON.stringify({
          appMapId: "shop-android",
          combineId: "chat-prompts",
          targetKind: "device",
          targetId: "<android-device-serial>",
          platform: "android",
          intervalMinutes: 30,
          enabled: false,
        })}'`,
      ],
      note: "A saved native Test is scheduled through Run Across: include it in a saved Plan/Combine first, then schedule that combineId with appMapId. Qualify the Plan manually before enabling its paused schedule. Selected input Data set rows freeze approved Project values for each case. An unselected list defaults to its first value; a changing schedule seed does not rotate its prompts. Schedules accept recipeId or combineId, not a testId or per-schedule runtime variables.",
    }),
  ),
  mapped("schedule.delete", path("schedule delete", ["scheduleId"])),
  mapped("matrix.list", path("matrix list")),
  mapped("matrix.create", path("matrix create")),
  mapped("matrix.update", path("matrix update", ["matrixId"])),
  mapped("matrix.delete", path("matrix delete", ["matrixId"])),
  mapped("matrix.import", path("matrix import")),
  mapped("matrix.resolve", path("matrix resolve", ["matrixId"])),

  mapped("presence.list", path("presence list")),
  mapped("presence.upsert", path("presence upsert")),
  mapped("presence.clear", path("presence clear", ["actorId"])),

  mapped("discovery.list", path("discovery list")),
  mapped("discovery.create", path("discovery create")),
  mapped("discovery.get", path("discovery get", ["sessionId"])),
  mapped("discovery.rename", path("discovery rename", ["sessionId"])),
  mapped("discovery.status.update", path("discovery status update", ["sessionId"])),
  mapped("discovery.capture", path("discovery capture", ["sessionId", "serial"])),
  mapped("discovery.interact", path("discovery interact", ["sessionId", "serial"])),
  mapped("discovery.here", path("discovery here", ["sessionId"])),
  mapped("discovery.do", path("discovery do", ["sessionId", "serial"])),
  mapped("discovery.suggestion", path("discovery suggestion", ["sessionId"])),
  mapped("discovery.coverage", path("discovery coverage", ["sessionId"])),
  mapped("discovery.exploration-timeline", path("discovery exploration-timeline", ["sessionId"])),
  mapped("discovery.export", path("discovery export", ["sessionId"])),
  mapped("discovery.start", path("discovery start", ["sessionId"])),
  mapped("discovery.cancel", path("discovery cancel", ["sessionId"])),
  mapped("discovery.promote", path("discovery promote", ["sessionId"])),

  mapped("job.list", path("job list")),
  mapped(
    "job.get",
    path("job get", ["jobId"]),
    path("job watch", ["jobId"], undefined, {
      summary: "Watch an execution job until it finishes",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
      behavior: "job-watch",
    }),
  ),
  mapped(
    "job.start",
    path("job start", [], undefined, {
      summary: "Start a compiled job (prefer relay flow run for map paths)",
      examples: [
        'relay flow run checkout main --input \'{"serial":"<phone-serial>","platform":"ios"}\'',
      ],
    }),
  ),
  mapped(
    "job.retry",
    path("job retry", ["jobId"], undefined, {
      summary: "Retry an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.cancel",
    path("job cancel", ["jobId"], undefined, {
      summary: "Cancel an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.pause",
    path("job pause", ["jobId"], undefined, {
      summary: "Pause an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.resume",
    path("job resume", ["jobId"], undefined, {
      summary: "Resume an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped("job.active.cancel", path("job active cancel")),
  mapped("job.matrix.start", path("job matrix start")),
  mapped("job.compatibility-matrix.start", path("job compatibility-matrix start")),
  mapped("job.soak.start", path("job soak start")),
  mapped(
    "job.combine.start",
    path("job combine start", [], undefined, {
      summary: "Run every selected Variable value × every selected Test",
      examples: [
        'relay combine run shop-ios language-x-settings --cell ja --input \'{"serial":"<device>","platform":"ios"}\'',
        'relay combine run shop-ios language-x-settings --all --input \'{"serial":"<device>","platform":"ios"}\'',
        "relay combine run shop-web hourly --lane lab --all",
      ],
      note: "Default is one cell. Pass --cell to choose a world, or --all to run every selected cell. A default serial/target fills missing cell bindings. Per-cell cellRuntimeProfiles and cellTargetBindings remain overrides. For a local multi-target campaign, pass cellTargetBindings plus the shared localAdmission object. Missing Variable, empty selection, or a Variable that cannot apply still return 409 and queue nothing.",
      behavior: "job-start-watch",
    }),
    path("combine run", ["appMapId", "combineId"], undefined, {
      summary: "Run one cell of a saved Combine (Variables × Tests)",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "combineId", type: "string", description: "Saved Combine" },
      ],
      inputHelp: [
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
      examples: ["relay combine run shop-web hourly --lane lab --all"],
      behavior: "job-start-watch",
    }),
    planRunCommandPath,
  ),
  mapped(
    "job.combine.campaign.get",
    path("combine campaign get", ["batchId"], undefined, {
      summary: "Inspect pilot, pending cases, problems, and resume state",
      argumentHelp: [{ name: "batchId", type: "string", description: "Combine campaign ID" }],
    }),
  ),
  {
    operationId: "job.combine.campaign.repeat.active",
    exclusion: "internal",
    reason: "The Repeat workflow uses this read-only lookup to adopt durable unfinished work.",
  },
  mapped(
    "job.combine.campaign.repeat.clusters",
    path("combine campaign failures", ["batchId"], undefined, {
      summary: "Review equivalent Repeat failure clusters before a selective rerun",
      argumentHelp: [{ name: "batchId", type: "string", description: "Combine campaign ID" }],
      inputHelp: [
        {
          name: "failureKind",
          type: "causal | visual | localization | network | crash",
          description: "Optional deterministic failure-signature filter",
        },
        {
          name: "cohort",
          type: "string",
          description: "Optional exact target cohort filter",
        },
      ],
    }),
  ),
  mapped(
    "job.combine.campaign.resume",
    path("combine campaign resume", ["batchId"], undefined, {
      summary: "Resume only untouched cases from current App Map truth",
      argumentHelp: [{ name: "batchId", type: "string", description: "Combine campaign ID" }],
      inputHelp: [
        {
          name: "reviewed",
          type: "boolean",
          description: "Required after a pilot problem has been reviewed or repaired",
        },
      ],
      behavior: "job-start-watch",
    }),
  ),
  mapped(
    "job.combine.campaign.cancel",
    path("combine campaign cancel", ["batchId"], undefined, {
      summary: "Cancel active work and leave untouched cases unscheduled",
      argumentHelp: [{ name: "batchId", type: "string", description: "Combine campaign ID" }],
    }),
  ),
  mapped(
    "job.combine.campaign.triage",
    path("combine campaign triage", ["batchId"], undefined, {
      summary: "Assign or mark Combine campaign cases without changing execution status",
      argumentHelp: [{ name: "batchId", type: "string", description: "Combine campaign ID" }],
      inputHelp: [
        {
          name: "caseIds",
          type: "array",
          description: "Campaign case or cell identifiers to update",
        },
        {
          name: "triageStatus",
          type: "unreviewed | investigating | resolved | wont-fix",
          description: "Review status. Independent of execution status.",
        },
        {
          name: "assignee",
          type: "string",
          description: "Review owner. Empty string clears ownership.",
        },
      ],
    }),
  ),
  mapped(
    "job.combine.export",
    path("combine export", ["batchId"], undefined, {
      summary: "Export a Combine screenshot pack",
      examples: [
        "relay combine export <batch-id>",
        "relay combine export <batch-id> --export ./review --todo ./todo.json",
      ],
      note: "Writes a portable review folder. index.html opens with a Test checklist (passed | check failed | could not run | todo), before/after PNGs, visual-comparison ids, and `relay run visual review <job>`. Confirm/Reject never accept a visual baseline. Optional --export copies the pack; --todo merges unbound/gated rows.",
    }),
  ),
  mapped(
    "job.combine.analysis",
    path("combine analyze", ["batchId"], undefined, {
      summary: "Read durable findings from a Variable × Test Combine",
      note: "Reads the current Combine evidence without writing a pack.",
    }),
    planFindingsCommandPath,
  ),
  mapped("job.combine.capture.review", planCaptureReviewCommandPath),
  mapped("job.combine.capture.review.apply", planCaptureReviewApplyCommandPath),

  ...runEvidenceCommandDescriptors,
  mapped(
    "run.trace-pack.get",
    path("run trace-pack get", ["runId"], undefined, {
      summary: "Export one content-addressed Run TracePack for offline analysis",
    }),
  ),
  mapped(
    "run.repair.list",
    path("repair list", [], undefined, {
      summary: "List addressable failed-check repair targets",
    }),
  ),
  mapped(
    "run.repair.get",
    path("repair get", ["runId", "checkId"], undefined, {
      summary: "Inspect one complete failed-check repair package",
    }),
  ),
  mapped(
    "run.repair.retry",
    path("repair retry", ["runId", "checkId"], undefined, {
      summary: "Retry only one failed check from immutable run evidence",
      behavior: "job-start-watch",
      note: "Proves the live origin, then runs only the warm failed check. No setup or app launch is replayed; the original run and saved Test remain unchanged.",
    }),
  ),
  mapped(
    "run.repair.propose",
    path("repair propose", ["runId", "checkId"], undefined, {
      summary: "Create a reversible review branch from one failed check",
      inputHelp: [
        {
          name: "kind",
          type: "retarget | accept-current | disable",
          required: true,
          description: "Reviewed document change; never mutates the source run",
        },
        { name: "reason", type: "string", required: true, description: "Audit reason" },
        {
          name: "selector",
          type: "object",
          description: "Exact successful runtime selector; required only for retarget",
        },
        {
          name: "equivalentTargets",
          type: "array",
          description: "Same-diff run/check pairs reviewed together without merging their evidence",
        },
      ],
      examples: [
        'relay repair propose <run-id> <check-id> --input \'{"kind":"retarget","reason":"Reviewed current accessibility id","selector":{"identifier":"settings-row"}}\'',
      ],
    }),
  ),
  mapped(
    "run.replay",
    path("run replay", ["runId"], undefined, {
      summary: "Replay a persisted run's recorded device actions",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      examples: ["relay run replay <run-id>"],
      note: "Requires exclusive control of the original target and watches the replay job to completion.",
      behavior: "job-start-watch",
    }),
  ),
  mapped("run.catalog.rebuild", path("run catalog rebuild")),
  mapped("run.retention.apply", path("run retention apply")),
  mapped(
    "run.review",
    path("run review", ["runId"], undefined, {
      summary: "Approve or reject a deferred verification",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [
        {
          name: "action",
          type: '"approve" | "reject"',
          required: true,
          description: "Approve the check as correct or reject it",
        },
        { name: "note", type: "string", description: "Optional reviewer note" },
      ],
      examples: ['relay run review <run-id> --input \'{"action":"approve"}\''],
    }),
  ),
  mapped(
    "run.visual-baseline.update",
    path("run visual-baseline update", ["runId"], { action: "approve-new-baseline" }),
    path(
      "run approve",
      ["runId"],
      { action: "approve-new-baseline" },
      {
        summary: "Approve a run as the visual baseline",
        argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      },
    ),
  ),
  mapped("run.visual.compare", path("run visual compare", ["runId"])),
  mapped(
    "run.visual.review",
    path("run visual review", ["runId"], undefined, {
      summary: "Record an explicit visual comparison decision",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [
        {
          name: "comparisonId",
          type: "string",
          required: true,
          description: "Id returned by run visual compare",
        },
        {
          name: "action",
          type: '"approve-new-baseline" | "keep-baseline" | "fix-connection" | "retry" | "mark-expected-variation"',
          required: true,
          description: "Human pixel decision. Findings Confirm/Reject never set this.",
        },
        { name: "note", type: "string", description: "Optional reviewer note" },
      ],
      examples: [
        'relay run visual review <run-id> --input \'{"comparisonId":"<id>","action":"approve-new-baseline"}\' --actor human:local-cli',
      ],
      note: "agent:* cannot accept a baseline. Confirm/Reject stay notes-only.",
    }),
  ),
  mapped(
    "run.capture.review",
    path("run capture review", ["runId"], undefined, {
      summary: "Record a human decision on one captured screenshot",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [
        {
          name: "captureId",
          type: "string",
          required: true,
          description: "Capture identity from the Run captures panel",
        },
        {
          name: "action",
          type: '"accept" | "accept-as-reference" | "report-issue" | "need-more-evidence"',
          required: true,
          description:
            "Looks correct (also makes this image the reference for later runs), report an issue, or ask for more evidence.",
        },
        {
          name: "imageSha256",
          type: "string",
          description: "Exact image hash shown in the review panel",
        },
        { name: "note", type: "string", description: "Optional reviewer note" },
      ],
      examples: [
        'relay run capture review <run-id> --input \'{"captureId":"frames/001.png::abc","action":"accept","imageSha256":"abc"}\' --actor human:local-cli',
      ],
      note: "Looks correct reviews this exact image. Accept as reference makes it the reference for later matching Runs. Review does not require an AI key.",
    }),
  ),
  mapped(
    "review.inbox.list",
    path("review list", [], undefined, {
      summary: "Screenshots that changed or are new, from the latest run of every Test",
      inputHelp: [
        { name: "sinceDays", type: "number", description: "Look back this many days (14)" },
        { name: "appMapId", type: "string", description: "Only this App" },
      ],
      examples: ["relay review list", 'relay review list --input \'{"appMapId":"shop-ios"}\''],
    }),
  ),
  mapped(
    "run.capture.reference.compare",
    path("run capture compare", ["runId"], undefined, {
      summary: "Compare a Run's screenshots with their references again",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
    }),
  ),
  mapped(
    "run.capture.reference.ignore-regions.update",
    path("run capture ignore", ["runId"], undefined, {
      summary: "Set the areas a screenshot comparison ignores (clocks, live data)",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [
        { name: "captureId", type: "string", required: true, description: "Capture identity" },
        {
          name: "regions",
          type: "{x,y,width,height,name?}[]",
          required: true,
          description: "Rectangles in 0..1 image coordinates",
        },
      ],
    }),
  ),
  mapped("run.visual-policy.get", path("run visual-policy get", ["runId"])),
  mapped("run.visual-policy.update", path("run visual-policy update", ["runId"])),
  mapped(
    "run.pin.update",
    path("run pin", ["runId"], undefined, {
      summary: "Pin or unpin a run",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [{ name: "pinned", type: "boolean", description: "Defaults to true" }],
    }),
  ),
  mapped("step.run", path("run step", ["serial"])),
  mapped("generation.create", path("generation create")),
  mapped(
    "action.run",
    path("action run", ["actionId", "serial"], undefined, {
      summary: "Run a reusable routine on a device",
      argumentHelp: [
        { name: "actionId", type: "string", description: "Reusable action identifier" },
        { name: "serial", type: "string", description: "Connected device serial" },
      ],
      examples: ["relay action run login emulator-5554"],
    }),
  ),
];
