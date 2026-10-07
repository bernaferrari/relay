import type { CliOperationDescriptor } from "./command-descriptors.js";

/** Keep external evidence sharing discoverable without making the already
 * broad command registry own another command family. */
export const runEvidenceCommandDescriptors: readonly CliOperationDescriptor[] = [
  {
    operationId: "run.list",
    paths: [{ command: "run list" }],
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
