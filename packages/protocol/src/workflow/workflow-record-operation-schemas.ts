import * as z from "zod/v4";
import type { WorkflowJsonValue } from "./workflow-record.js";
import {
  authoringInteraction,
  authoringRecordingEdit,
  destination,
} from "../operation/operation-schema-primitives.js";
import { authoringSessionSchema } from "../authoring/authoring-session-schema.js";
import { combineCampaignSchema } from "../combine/combine-output-schemas.js";
import { executionJobSchema } from "../execution/execution-target-schemas.js";

const identifier = z.string().trim().min(1).max(256);
const workflowJson: z.ZodType<WorkflowJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(workflowJson),
    z.record(z.string().min(1).max(256), workflowJson),
  ]),
);
const resource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("job"), id: identifier }).strict(),
  z.object({ kind: z.literal("authoring-session"), id: identifier }).strict(),
  z.object({ kind: z.literal("campaign"), id: identifier }).strict(),
]);
const status = z.enum(["active", "needs-attention", "terminal", "expired"]);
const resolution = z
  .object({
    kind: z.literal("abandoned"),
    reason: z.string().trim().min(1).max(1_000),
    at: z.number().int().nonnegative(),
  })
  .strict();
const kind = z.enum(["run-test", "author-test", "repeat-test"]);
const record = z
  .object({
    schemaVersion: z.literal(1),
    workflowId: identifier,
    organizationId: identifier,
    projectId: identifier,
    kind,
    version: z.number().int().positive(),
    status,
    frozenIdentity: workflowJson,
    creationIdentity: workflowJson.optional(),
    creationResource: resource.nullable().optional(),
    resource: resource.optional(),
    createdBy: identifier,
    lastActorId: identifier,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    lastTransition: identifier,
    resolution: resolution.optional(),
    adoptedLegacyRefDigest: identifier.optional(),
  })
  .strict();
const auditEvent = z
  .object({
    schemaVersion: z.literal(1),
    workflowId: identifier,
    sequence: z.number().int().positive(),
    version: z.number().int().positive(),
    actorId: identifier,
    transition: identifier,
    status,
    resource: resource.optional(),
    resolution: resolution.optional(),
    at: z.number().int().nonnegative(),
  })
  .strict();
const workflow = z.object({ record, audit: z.array(auditEvent) }).strict();
const output = z
  .object({
    workflow,
    job: executionJobSchema.optional(),
    session: authoringSessionSchema.optional(),
    campaign: combineCampaignSchema.optional(),
  })
  .strict();

const transitionFence = {
  workflowId: identifier,
  expectedVersion: z.number().int().positive(),
};

const transitionLabel = z.string().trim().min(1).max(256);
const transitionTestName = z.string().trim().min(1).max(160);
const transitionReason = z.string().trim().min(1).max(1_000);
const transitionBranch = <Action extends string, Shape extends z.ZodRawShape>(
  action: Action,
  shape: Shape,
) => z.object({ ...transitionFence, ...shape, action: z.literal(action) }).strict();
const workflowTransitionBranches = z.discriminatedUnion("action", [
  transitionBranch("attach-run", { jobId: identifier }),
  transitionBranch("abandon-run", { reason: transitionReason }),
  transitionBranch("cancel-run", {}),
  transitionBranch("start-authoring", { leaseId: identifier }),
  transitionBranch("authoring-record", {
    interaction: authoringInteraction,
    mutationId: identifier.optional(),
  }),
  transitionBranch("authoring-checkpoint", { label: transitionLabel.optional() }),
  transitionBranch("authoring-stop", {}),
  transitionBranch("authoring-edit", { edit: authoringRecordingEdit }),
  transitionBranch("authoring-replay", {}),
  transitionBranch("authoring-approve", {
    destination: destination.optional(),
    testName: transitionTestName.optional(),
  }),
  transitionBranch("authoring-discard", {}),
  transitionBranch("authoring-cancel", {}),
  transitionBranch("authoring-abandon", { reason: transitionReason }),
  transitionBranch("reserve-repeat-pilot", {}),
  transitionBranch("attach-repeat", { campaignId: identifier }),
  transitionBranch("reserve-repeat-resume", { reviewed: z.boolean().optional() }),
  transitionBranch("complete-repeat-resume", {}),
  transitionBranch("reserve-repeat-cancel", {}),
  transitionBranch("complete-repeat-cancel", {}),
]);
export type WorkflowTransitionPayload = z.output<typeof workflowTransitionBranches>;

const transitionShape = {
  ...transitionFence,
  action: z.enum([
    "attach-run",
    "abandon-run",
    "cancel-run",
    "start-authoring",
    "authoring-record",
    "authoring-checkpoint",
    "authoring-stop",
    "authoring-edit",
    "authoring-replay",
    "authoring-approve",
    "authoring-discard",
    "authoring-cancel",
    "authoring-abandon",
    "reserve-repeat-pilot",
    "attach-repeat",
    "reserve-repeat-resume",
    "complete-repeat-resume",
    "reserve-repeat-cancel",
    "complete-repeat-cancel",
  ]),
  jobId: identifier.optional(),
  campaignId: identifier.optional(),
  leaseId: identifier.optional(),
  reviewed: z.boolean().optional(),
  interaction: authoringInteraction.optional(),
  mutationId: identifier.optional(),
  label: transitionLabel.optional(),
  edit: authoringRecordingEdit.optional(),
  destination: destination.optional(),
  testName: transitionTestName.optional(),
  reason: transitionReason.optional(),
};

const projectTransition = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) => Object.hasOwn(transitionShape, key) && item !== undefined,
    ),
  );

export const workflowRecordOperationInputSchemas = {
  "workflow.create": z
    .object({
      workflowId: identifier.optional(),
      kind: kind.optional(),
      frozenIdentity: workflowJson.optional(),
      legacyRef: z
        .string()
        .min(1)
        .max(96 * 1024)
        .optional(),
      expiresAt: z.number().int().nonnegative().optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const adoptsLegacy = value.legacyRef !== undefined;
      if (adoptsLegacy && (value.kind !== undefined || value.frozenIdentity !== undefined)) {
        context.addIssue({
          code: "custom",
          message: "legacyRef cannot be combined with kind or frozenIdentity",
        });
      }
      if (!adoptsLegacy && (value.kind === undefined || value.frozenIdentity === undefined)) {
        context.addIssue({
          code: "custom",
          message: "kind and frozenIdentity are required for a new workflow",
        });
      }
    }),
  "workflow.get": z.object({ workflowId: identifier }).strict(),
  "workflow.transition": z
    .object(transitionShape)
    .strict()
    .refine(
      (value): value is typeof value & WorkflowTransitionPayload =>
        workflowTransitionBranches.safeParse(projectTransition(value)).success,
      {
        error: ({ input }) => {
          const result = workflowTransitionBranches.safeParse(
            projectTransition(input as Record<string, unknown>),
          );
          return result.success
            ? "Invalid workflow transition"
            : result.error.issues
                .map(
                  (issue) => `${issue.path.join(".") || "workflow.transition"}: ${issue.message}`,
                )
                .join("; ");
        },
      },
    ),
} as const;

export const workflowRecordOperationOutputSchemas = {
  "workflow.create": output.extend({ disposition: z.enum(["created", "existing"]) }),
  "workflow.get": output,
  "workflow.transition": output,
} as const;
