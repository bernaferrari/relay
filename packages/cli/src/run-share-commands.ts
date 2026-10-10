import type { CliOperationDescriptor } from "./command-descriptors.js";

/** Keep external evidence sharing discoverable without making the already
 * broad command registry own another command family. */
export const runEvidenceCommandDescriptors: readonly CliOperationDescriptor[] = [
  {
    operationId: "run.list",
    paths: [{ command: "run list", summary: "List recent runs (everyday: relay runs)" }],
  },
  {
    operationId: "app-map.observed",
    exclusion: "ui-only",
    reason: "The Map view's observed-screens projection; the CLI reads screens with map get.",
  },
  {
    operationId: "app-map.test.draft",
    exclusion: "internal",
    reason: "relay new drafts and saves in one call through test.create-from-goal.",
  },
  {
    operationId: "system.model-key.set",
    exclusion: "unsafe",
    reason: "Model keys are set in the app's Settings or the environment, never as CLI arguments.",
  },
  {
    operationId: "test.apply-yaml",
    exclusion: "internal",
    reason: "relay apply, relay new --file, and relay ci <folder> send test files through it.",
  },
  {
    operationId: "test.yaml.get",
    exclusion: "internal",
    reason: "relay show prints a Test as its file.",
  },
  {
    operationId: "run.verdict.get",
    paths: [
      {
        command: "run verdict",
        arguments: ["runId"],
        summary: "Did the run pass? Status, summary, and each step's expected vs. saw",
        argumentHelp: [{ name: "runId", type: "string", description: "Run identifier" }],
        examples: ["relay run verdict <runId> --json"],
      },
    ],
  },
  {
    operationId: "test.create-from-goal",
    paths: [
      {
        command: "test new",
        arguments: ["goal"],
        summary: "Describe what should work in plain English; Relay writes and saves the Test",
        argumentHelp: [
          { name: "goal", type: "string", description: "What should work, or one step per line" },
        ],
        inputHelp: [
          { name: "url", type: "string", description: "Website the Test opens first" },
          { name: "app", type: "string", description: "Existing app id or name" },
        ],
        examples: [
          'relay new "Add a shirt to the cart and check the total" --url https://shop.example.com',
        ],
        note: 'Everyday spelling: relay new "<goal>" [--url <website>] [--app <name>].',
      },
    ],
  },
  {
    operationId: "run.get",
    exclusion: "internal",
    reason: "Exposed through the read-only `relay run get` resource command.",
  },
  {
    operationId: "run.panel-manifest.get",
    paths: [
      {
        command: "run panel-manifest get",
        arguments: ["runId"],
        summary: "Read bounded retained Run metadata",
        inputHelp: [
          { name: "offset", type: "number", description: "First retained step to include" },
          { name: "limit", type: "number", description: "Maximum retained steps to include" },
        ],
      },
    ],
  },
  {
    operationId: "run.replay.offline",
    exclusion: "internal",
    reason: "Exposed through the read-only `relay run replay-offline` resource command.",
  },
  {
    operationId: "run.evidence.get",
    exclusion: "internal",
    reason: "Exposed through the read-only `relay run evidence` resource command.",
  },
  {
    operationId: "run.story.get",
    exclusion: "internal",
    reason: "Exposed through the read-only `relay run story` resource command.",
  },
  {
    operationId: "run.walkthrough-pack.get",
    paths: [
      {
        command: "run walkthrough-pack get",
        arguments: ["runId"],
        summary: "Export a captured-app walkthrough for one run and any joined runs",
        note: "Each joined run keeps its own captures. A changed or missing review frame refuses the export and names that frame. Human output is a passive HTML page. --out writes that page as walkthrough.html beside result.json. --json keeps the structured pack. A downloaded copy cannot be recalled.",
        inputHelp: [
          {
            name: "with",
            type: "string",
            description: "Comma-separated run ids to join, or a list of run ids.",
          },
        ],
        examples: [
          "relay run walkthrough-pack get <run-id>",
          "relay --out ./review run walkthrough-pack get <run-id>",
          'relay run walkthrough-pack get <run-id> --input \'{"with":["admin-run"]}\'',
        ],
      },
    ],
  },
  {
    operationId: "run.share.list",
    paths: [
      {
        command: "run share list",
        arguments: ["runId"],
        summary: "List active, expired, and revoked links for a run",
      },
    ],
  },
  {
    operationId: "run.share.create",
    paths: [
      {
        command: "run share create",
        arguments: ["runId"],
        summary: "Create an expiring signed report link",
        note: "When the host sets RELAY_PUBLIC_BASE_URL the response includes an absolute `url`; otherwise resolve `path` against the server origin.",
        inputHelp: [
          {
            name: "expiresInHours",
            type: "number",
            required: true,
            description: "Link lifetime from 5 minutes through 30 days",
          },
          {
            name: "includeBatch",
            type: "boolean",
            description: "Include every result from the same matrix batch",
          },
        ],
        examples: [
          'relay run share create <run-id> --input \'{"expiresInHours":24,"includeBatch":true}\'',
        ],
      },
    ],
  },
  {
    operationId: "run.share.revoke",
    paths: [
      {
        command: "run share revoke",
        arguments: ["runId", "shareId"],
        summary: "Immediately invalidate a signed report link",
      },
    ],
  },
];
