import type { RelayOutcomeJobs } from "@relay/workflows";
import * as z from "zod/v4";

type OutcomeInputSchema = z.ZodType<Record<string, unknown>>;

const identifier = z.string().trim().min(1);
const targetId = identifier.optional().describe("Only needed when more than one device is ready");

/** The Agent Debug input contract is kept beside its handler so the public
 * outcome registry does not become a second implementation of this flow. */
export function createDebugBugInputSchema(
  verifyChangeSelectionTransport: z.ZodType,
): OutcomeInputSchema {
  return z.discriminatedUnion("action", [
    z
      .object({
        kind: z.literal("debug-bug"),
        action: z.literal("start"),
        title: identifier,
        appMapId: identifier.optional(),
        targetId,
      })
      .strict(),
    z
      .object({
        kind: z.literal("debug-bug"),
        action: z.literal("explore"),
        create: z
          .object({
            id: identifier.optional(),
            name: identifier,
            targetId: identifier,
            appMapId: identifier.optional(),
            goal: z.string().max(2_048).optional(),
            scope: z
              .object({
                maxScreens: z.number().int().min(1).max(500),
                maxTransitions: z.number().int().min(1).max(2_000),
                maxDurationMs: z.number().int().min(1).max(3_600_000),
              })
              .strict(),
          })
          .strict(),
        start: z
          .object({
            sessionId: identifier,
            strategy: z.enum(["surface", "timeline", "hard-edges"]).optional(),
            maxDepth: z.number().int().min(1).max(12).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("debug-bug"),
        action: z.literal("run"),
        appMapId: identifier.optional(),
        testId: identifier,
        targetId,
      })
      .strict(),
    z
      .object({ kind: z.literal("debug-bug"), action: z.literal("inspect"), runId: identifier })
      .strict(),
    z
      .object({
        kind: z.literal("debug-bug"),
        action: z.literal("propose-repair"),
        runId: identifier,
        checkId: identifier,
        proposal: z.enum(["accept-current", "disable"]),
        reason: identifier.max(2_048),
      })
      .strict(),
    z
      .object({
        kind: z.literal("debug-bug"),
        action: z.literal("verify"),
        selection: verifyChangeSelectionTransport,
        confirmationSatisfied: z.literal(true).optional(),
      })
      .strict(),
    z
      .object({ kind: z.literal("debug-bug"), action: z.literal("export"), runId: identifier })
      .strict(),
  ]) as unknown as OutcomeInputSchema;
}

export function createDebugBugOutcomeTool(inputSchema: OutcomeInputSchema) {
  return {
    name: "relay_debug_bug" as const,
    title: "Debug a bug",
    description:
      "Advance one bounded Agent Debug stage: start a controlled recording, explore within an explicit budget, run an existing reviewed Test, inspect immutable failure evidence, create a review-only repair proposal, analyze a change, or export its TracePack. This outcome never approves a Test, applies a repair, clusters failures, or claims future device behavior.",
    requiresConfirmation: false,
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false as const,
    },
  };
}

export async function invokeDebugBugOutcomeTool(input: {
  parsed: Record<string, unknown>;
  confirmed: boolean;
  jobs: RelayOutcomeJobs;
}): Promise<unknown> {
  const { parsed, confirmed, jobs } = input;
  const action = parsed.action;
  if ((action === "start" || (action === "explore" && parsed.start)) && !confirmed) {
    throw new TypeError("relay_debug_bug requires confirm: true for target control.");
  }
  if (action === "start") {
    return jobs.debugBug({
      ...parsed,
      kind: "debug-bug",
      confirmControl: true,
    } as Parameters<RelayOutcomeJobs["debugBug"]>[0]);
  }
  if (action === "run") {
    return jobs.debugBug({
      ...parsed,
      kind: "debug-bug",
      ...(confirmed ? { confirmRisk: true } : {}),
    } as Parameters<RelayOutcomeJobs["debugBug"]>[0]);
  }
  return jobs.debugBug(parsed as never);
}
