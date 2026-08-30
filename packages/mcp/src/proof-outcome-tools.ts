import * as z from "zod/v4";
import type { RelayOutcomeToolDescriptor } from "./outcome-tools.js";

const identifier = z.string().trim().min(1);

export const proofOutcomeTools = Object.freeze([
  {
    name: "relay_inspect_proof",
    title: "Inspect a Proof",
    description:
      "Read one durable Change Proof, its server-owned execution progress, publication state, and optional bounded history. Use this after preparation, human plan review, reconnect, or execution; never infer a verdict from a prior response.",
    requiresConfirmation: false,
    inputSchema: z.object({ proofId: identifier, includeHistory: z.boolean().optional() }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_prove_change",
    title: "Prove a change",
    description:
      "Prepare the current repository change when proofId is omitted, or run/resume one approved server-owned Proof when proofId is supplied. Returns durable progress or the exact next required action. Repeating the same call never selects another case or retries an uncertain outcome.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        proofId: identifier.optional(),
        baseRef: z.string().trim().min(1).max(512).optional(),
        pullRequest: z.number().int().positive().optional(),
        agentClaim: z
          .object({
            summary: z.string().trim().min(1).max(4_096),
            acceptanceCriteria: z.array(z.string().trim().min(1).max(4_096)).max(64),
          })
          .strict()
          .optional(),
        targetIds: z.array(identifier).min(1).max(250).optional(),
        buildIds: z.array(identifier).min(1).max(32).optional(),
        expectedVersion: z.number().int().positive().optional(),
        wait: z.boolean().optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (!value.proofId && (value.expectedVersion !== undefined || value.wait !== undefined)) {
          context.addIssue({
            code: "custom",
            message:
              "expectedVersion and wait require proofId; omit proofId to prepare the current change",
          });
        }
        if (
          value.proofId &&
          (value.baseRef ||
            value.pullRequest ||
            value.agentClaim ||
            value.targetIds ||
            value.buildIds)
        ) {
          context.addIssue({
            code: "custom",
            message: "preparation fields are only valid when proofId is omitted",
          });
        }
      }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const satisfies readonly RelayOutcomeToolDescriptor[]);
