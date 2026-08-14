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
    operationId: "run.evidence.get",
    exclusion: "internal",
    reason: "Exposed through the read-only `relay run evidence` resource command.",
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
