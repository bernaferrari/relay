import * as z from "zod/v4";
import type { WorkflowJsonValue } from "./workflow-record.js";
import {
  authoringInteraction,
  authoringRecordingEdit,
  destination,
} from "./operation-schema-primitives.js";

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
    job: z.record(z.string(), z.unknown()).optional(),
    session: z.record(z.string(), z.unknown()).optional(),
    campaign: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const transitionFence = {
  workflowId: identifier,
  expectedVersion: z.number().int().positive(),
};

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
    .object({
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
      label: z.string().trim().min(1).max(256).optional(),
      edit: authoringRecordingEdit.optional(),
      destination: destination.optional(),
      reason: z.string().trim().min(1).max(1_000).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const required = (present: boolean, message: string) => {
        if (!present) context.addIssue({ code: "custom", message });
      };
      if (value.action === "attach-run")
        required(Boolean(value.jobId), "attach-run requires jobId");
      if (value.action === "abandon-run")
        required(Boolean(value.reason), "abandon-run requires reason");
      if (value.action === "start-authoring") {
        required(Boolean(value.leaseId), "start-authoring requires leaseId");
      }
      if (value.action === "authoring-record") {
        required(Boolean(value.interaction), "authoring-record requires interaction");
      }
      if (value.action === "authoring-edit") {
        required(Boolean(value.edit), "authoring-edit requires edit");
      }
      if (value.action === "authoring-abandon") {
        required(Boolean(value.reason), "authoring-abandon requires reason");
      }
      if (value.action === "attach-repeat") {
        required(Boolean(value.campaignId), "attach-repeat requires campaignId");
      }
      const allowed = new Set<string>(["workflowId", "expectedVersion", "action"]);
      if (value.action === "attach-run") allowed.add("jobId");
      if (value.action === "abandon-run") allowed.add("reason");
      if (value.action === "start-authoring") allowed.add("leaseId");
      if (value.action === "authoring-record") allowed.add("interaction");
      if (value.action === "authoring-checkpoint") allowed.add("label");
      if (value.action === "authoring-edit") allowed.add("edit");
      if (value.action === "authoring-approve") allowed.add("destination");
      if (value.action === "authoring-abandon") allowed.add("reason");
      if (value.action === "attach-repeat") allowed.add("campaignId");
      if (value.action === "reserve-repeat-resume") allowed.add("reviewed");
      for (const [key, item] of Object.entries(value)) {
        if (item !== undefined && !allowed.has(key)) {
          context.addIssue({ code: "custom", message: `${value.action} does not accept ${key}` });
        }
      }
    }),
} as const;

export const workflowRecordOperationOutputSchemas = {
  "workflow.create": output.extend({ disposition: z.enum(["created", "existing"]) }),
  "workflow.get": output,
  "workflow.transition": output,
} as const;
