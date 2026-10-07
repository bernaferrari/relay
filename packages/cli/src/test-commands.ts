import {
  commandPath as path,
  mappedOperation as mapped,
  type CommandPathDescriptor,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

export const graphTestListPath: CommandPathDescriptor = path("test list", ["appMapId"], undefined, {
  summary: "List saved Tests with recorded platforms and actions still needing work",
  examples: ["relay test list grok-android"],
  note: "discovery.status describes saved recordings, not live execution readiness. Choose a recorded Test, then compile it with one saved targetProfileId to inspect offline blockers. Drafts stay visible with needs-recording or needs-binding status.",
});

/**
 * Graph-native Test authoring and execution commands. Keep this order aligned
 * with the user workflow: create, edit, propose, inspect, run, then remove.
 */
export const graphTestCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped(
    "app-map.test.save",
    path("test save", ["appMapId", "testId"], undefined, {
      summary: "Save a graph-native scenario Test",
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "test",
          type: "object",
          required: true,
          description:
            "Test name and graph steps; kind must be scenario with intentSchemaVersion 1",
        },
        {
          name: "eventId",
          type: "string",
          description: "Stable idempotency key for safe retries",
        },
      ],
      examples: [
        'relay test save checkout smoke --input \'{"expectedRevision":7,"eventId":"create-smoke-v1","test":{"name":"Checkout smoke","kind":"scenario","intentSchemaVersion":1,"steps":[{"id":"submit-order","kind":"instruction","intent":"Submit the reviewed order","binding":{"status":"unresolved","reason":"Choose a mapped checkout connection"}}]}}\'',
      ],
      note: "Use `relay test propose` for reviewable edits to an existing Test. Stable step IDs survive reordering.",
    }),
  ),
  mapped(
    "app-map.test.edit",
    path("test edit", ["appMapId", "testId"], undefined, {
      summary: "Apply atomic stable-ID edits to a graph-native test",
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "edits",
          type: "array",
          required: true,
          description:
            "test.patch, step.add, step.patch, step.remove, step.reorder, step.bind, or step.unbind edits",
        },
      ],
      examples: [
        'relay test edit checkout smoke --input \'{"expectedRevision":7,"edits":[{"kind":"step.patch","stepId":"submit-order","patch":{"intent":"Submit the reviewed order"}}]}\'',
      ],
    }),
  ),
  mapped(
    "app-map.test.undo",
    path("test undo", ["appMapId", "testId"], undefined, {
      summary: "Undo the latest durable edit to a graph-native Test",
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "eventId",
          type: "string",
          description: "Stable idempotency key for safe retries",
        },
      ],
    }),
  ),
  mapped(
    "app-map.test.redo",
    path("test redo", ["appMapId", "testId"], undefined, {
      summary: "Redo the next durable edit to a graph-native Test",
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "eventId",
          type: "string",
          description: "Stable idempotency key for safe retries",
        },
      ],
    }),
  ),
  mapped(
    "app-map.test.propose",
    path("test propose", ["appMapId", "testId"], undefined, {
      summary: "Submit stable-ID Test edits for human review",
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "App Map revision the agent reviewed",
        },
        {
          name: "edits",
          type: "array",
          required: true,
          description: "The same semantic edits accepted by test edit",
        },
        { name: "proposalId", type: "string", description: "Optional stable proposal id" },
        { name: "title", type: "string", description: "Optional review title" },
      ],
      examples: [
        'relay test propose checkout smoke --input \'{"expectedRevision":7,"title":"Clarify checkout intent","edits":[{"kind":"step.patch","stepId":"submit-order","patch":{"intent":"Submit the reviewed order"}}]}\'',
      ],
    }),
  ),
  mapped(
    "app-map.test.compile",
    path("test compile", ["appMapId", "testId"], undefined, {
      summary: "Check an offline Test plan and report blockers; use --full for its full provenance",
      inputHelp: [
        {
          name: "entryCheckpointScreenId",
          type: "string",
          description:
            "Optional read-only warm-plan preview. Relay first requires this exact mapped screen at runtime; a mismatch stops for review instead of relaunching the app.",
        },
        {
          name: "targetProfileId",
          type: "string",
          description:
            "Optional read-only raw-evidence scope. Select the runtime profile explicitly so translated labels cannot borrow proof from another locale. `ios` and `android` follow a linked native companion Test on grok-ios / grok-android.",
        },
      ],
      examples: [
        'relay test compile grok-ios settings-tour --input \'{"entryCheckpointScreenId":"settings"}\'',
        'relay test compile grok-ios settings-tour --input \'{"targetProfileId":"ipad-pt-BR"}\'',
        'relay test compile grok-web test-grok-web-signed-in-home --input \'{"targetProfileId":"ios"}\'',
      ],
      note: "Human output summarizes the target, plan counts, blockers, and next action; add --full for the complete result. The returned plan always names its startup policy. This preview is offline: it does not contact a target or persist a Test edit. --json and --ndjson retain the complete result.",
    }),
  ),
  mapped(
    "app-map.test.from-intent",
    path("test from-intent", ["appMapId"], undefined, {
      summary: "Compile English onto existing ready App Map edges",
      inputHelp: [
        {
          name: "intent",
          type: "string",
          required: true,
          description: "Coverage goal such as Cover Settings",
        },
      ],
    }),
  ),
  mapped(
    "app-map.test.run",
    path("test run", ["appMapId", "testId"], undefined, {
      summary: "Run one Test, or this Test in selected Variable values as a Combine",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "testId", type: "string", description: "Graph-native Test identifier" },
      ],
      inputHelp: [
        {
          name: "laneId",
          type: "string",
          description:
            "Saved Lane. Server resolves expectedRevision, target, and account overlay. Use --lane; --input-file is not needed.",
        },
        {
          name: "expectedRevision",
          type: "number",
          description: "Exact saved App Map revision to run. Required unless --lane is set.",
        },
        {
          name: "target",
          type: "object",
          description: "Explicit device or browser target. Required unless --lane is set.",
        },
        {
          name: "targetProfileId",
          type: "string",
          description:
            "Optional saved runtime evidence profile, or ios/android to run the linked grok-ios / grok-android companion Test on that device.",
        },
        {
          name: "surfaceCapture",
          type: "object",
          description:
            'Optional run-only fresh evidence policy: { forceRecaptureScreenIds: ["voice"] }',
        },
        {
          name: "startup",
          type: "object",
          description:
            'Explicit startup: { mode: "cold" } runs the saved baseline; { mode: "verified-checkpoint", screenId: "settings" } first proves the live screen and runs its suffix. A checkpoint mismatch stops for review — it never falls back to a cold relaunch.',
        },
        {
          name: "in",
          type: "object",
          description:
            "Variable id → value ids. `relay test run map test --in language=ja,pt` upserts a Combine and starts a campaign. ios/android targetProfileId follows the same native companion as compile/run. Omit --in to run the Test once.",
        },
        {
          name: "variables",
          type: "object",
          description:
            "Runtime string inputs for referenced {{name}} placeholders in one Test. Project Data sets supply defaults; values are frozen before control. Cannot combine with in.",
        },
        {
          name: "lens",
          type: "visual | smoke | every-screen | failures-only | final-screen | none",
          description:
            "Capture lens for the Combine. visual is every-screen; smoke is failures-only.",
        },
        {
          name: "commit",
          type: "string",
          description:
            "Git SHA (7-40 hex) of the code under test. Frozen into the run manifest; falls back to GITHUB_SHA or CI_COMMIT_SHA.",
        },
        {
          name: "pr",
          type: "number",
          description: "Pull request number bound to this proof (falls back to CI_PR_NUMBER).",
        },
        {
          name: "branch",
          type: "string",
          description:
            "Branch name for provenance (falls back to GITHUB_REF_NAME or CI_COMMIT_REF_NAME).",
        },
        {
          name: "cell",
          type: "string",
          description: "Run one world, for example --cell ja. Default without --all is one cell.",
        },
        {
          name: "executionMode",
          type: "pilot | all",
          description: "Pilot is the default. Pass --all to run every selected world.",
        },
      ],
      examples: [
        "relay test run grok-web grok-web-open --lane grok-daily",
        "relay test run grok-android-manual-v2 supergrok-locale-tour --in language=hu,ro --lens visual --target current --revision current",
        "relay combine export <batch-id>",
        "relay test run checkout smoke --target current --revision current",
        'relay test run grok-android chat --target current --revision current --input \'{"variables":{"chat_prompt":"Explain why sailboats need a keel."}}\'',
        "relay test run grok-ios settings-tour --in language=ja,pt --lens visual --target current --revision current",
        'relay test run grok-ios settings-tour --input \'{"expectedRevision":115,"target":{"kind":"device","platform":"ios","targetId":"DEVICE"},"startup":{"mode":"verified-checkpoint","screenId":"settings"}}\'',
        'relay test run checkout smoke --input \'{"expectedRevision":7,"target":{"kind":"browser","platform":"browser","targetId":"checkout-web"}}\'',
        'relay test run checkout smoke --input \'{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"DEVICE"}}\'',
        'relay test run grok-web test-grok-web-signed-in-home --revision current --input \'{"targetProfileId":"android"}\'',
        'relay test run grok-web test-grok-web-signed-in-home --in language=en --revision current --input \'{"targetProfileId":"android"}\'',
      ],
      note: "Not a first poke: compiled wait-for/expect-screen poll the accessibility slot while pixels stay still and freeze the glass. Poke with `relay device screenshot` + `relay device interact` first. The run always freezes an exact revision and target. Pass --lane to have the server resolve them from a saved Lane. A person with one connected local device may resolve both explicitly with --target current --revision current; Relay prints the resolved facts before execution. Without --in this is one Test run. With --in, Relay upserts the Combine, fills default target bindings, and starts one cell unless --all is set. A paused job resumes its existing plan; a new run uses only the startup policy supplied here. Relay never turns a checkpoint mismatch into an implicit cold retry or relaunch.",
      behavior: "job-start-watch",
    }),
  ),
  mapped("app-map.test.remove", path("test remove", ["appMapId", "testId"])),
];
