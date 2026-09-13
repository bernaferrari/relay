import * as z from "zod/v4";
import type {
  CampaignCapacityCohortDurationEvidence,
  CampaignCapacityDurationInput,
  CampaignCapacityPlan,
  LocalCampaignCapacityDeadlineAssessment,
  LocalCampaignCapacityPreflight,
  LocalCampaignCapacityTargetCriticalPathPreflight,
  LocalCampaignCapacityTargetFact,
} from "./campaign-capacity-plan.js";
import type { CombineCampaign, LocalCampaignAdmissionRequest } from "./combine-campaign.js";
import type { LocalAgentDeviceExecutionTargetRef } from "./execution-target.js";

const platform = z.enum(["android", "ios", "browser"]);
const durationProvenance = z.enum(["observed-p50", "observed-p95", "supplied"]);

const durationInputSchema = z
  .object({
    workItemDurationMs: z.number(),
    provenance: durationProvenance,
    observedAt: z.number().optional(),
    sampleCount: z.number().optional(),
    maxAgeMs: z.number().optional(),
  })
  .strict() satisfies z.ZodType<CampaignCapacityDurationInput>;

const durationEvidenceSchema: z.ZodType<CampaignCapacityCohortDurationEvidence> = z
  .object({
    schemaVersion: z.literal(1),
    cohort: z
      .object({
        targetId: z.string(),
        platform,
        testId: z.string(),
        action: z.string(),
      })
      .strict(),
    duration: durationInputSchema.extend({
      provenance: z.enum(["observed-p50", "observed-p95"]),
      observedAt: z.number(),
      sampleCount: z.number(),
      maxAgeMs: z.number(),
    }),
    measurement: z
      .object({
        estimator: z.literal("campaign-duration-estimate"),
        recordSource: z.enum(["persisted-runs", "run-summaries", "mixed-read-only-records"]),
        durationSource: z.enum(["run-wall-clock", "evidence-completion"]),
        sampleIds: z.array(z.string()),
        observationWindow: z.object({ startedAt: z.number(), finishedAt: z.number() }).strict(),
      })
      .strict(),
  })
  .strict();

export const localCampaignAdmissionRequestSchema: z.ZodType<LocalCampaignAdmissionRequest> = z
  .object({
    deadlineMs: z.number(),
    durationEvidence: z.array(durationEvidenceSchema),
    setupHeadroomMs: z.number().optional(),
    recoveryHeadroomMs: z.number().optional(),
  })
  .strict();

const targetFactSchema: z.ZodType<LocalCampaignCapacityTargetFact> = z
  .object({
    targetId: z.string(),
    requestedPlatform: platform,
    observedPlatform: platform.optional(),
    availability: z.enum(["available", "unavailable", "stale"]),
    lease: z.enum(["available", "leased"]),
    workerId: z.string(),
    workerFact: z.enum(["scheduler", "derived-local-lane"]),
    reason: z
      .enum([
        "missing",
        "platform-mismatch",
        "offline",
        "not-booted",
        "developer-mode-disabled",
        "developer-services-unavailable",
        "stale-readiness",
      ])
      .optional(),
  })
  .strict();

const deadlineSchema: z.ZodType<LocalCampaignCapacityDeadlineAssessment> = z
  .object({
    requestedMs: z.number(),
    reservedHeadroomMs: z.number(),
    workBudgetMs: z.number(),
    estimatedParallelDurationMs: z.number().nullable(),
    capacity: z.enum(["within-budget", "outside-budget"]),
    assurance: z.enum(["measured-current", "measurement-stale", "supplied-estimate"]),
    achievableWithCurrentCapacity: z.boolean(),
  })
  .strict();

const timeEstimateSchema = z
  .object({ slots: z.number(), estimatedDurationMs: z.number().nullable() })
  .strict();
const budgetSchema = z
  .object({
    timeBudgetMs: z.number(),
    achievableWithCurrentCapacity: z.boolean(),
    requiredIndependentTargetSlots: z.number().nullable(),
    additionalIndependentTargetSlots: z.number().nullable(),
    minimumPossibleDurationMs: z.number(),
  })
  .strict();

const campaignPlanSchema: z.ZodType<CampaignCapacityPlan> = z
  .object({
    workItems: z.number(),
    estimatedWorkItemDurationMs: z.number(),
    slots: z.array(
      z
        .object({
          targetId: z.string(),
          platform: z.enum(["android", "ios", "browser"]),
          workerId: z.string(),
        })
        .strict(),
    ),
    excludedTargets: z.array(
      z
        .object({
          targetId: z.string(),
          platform: z.enum(["android", "ios", "browser"]),
          reasons: z.array(
            z.enum([
              "invalid-target",
              "duplicate-target",
              "unavailable",
              "stale",
              "leased",
              "worker-unknown",
              "worker-active",
              "worker-queued",
              "worker-saturated",
              "host-saturated",
            ]),
          ),
        })
        .strict(),
    ),
    workers: z.array(
      z
        .object({
          workerId: z.string(),
          capacity: z.number(),
          active: z.number(),
          queued: z.number(),
          freeCapacity: z.number(),
          slotCount: z.number(),
        })
        .strict(),
    ),
    hosts: z.array(
      z
        .object({
          workerId: z.string(),
          capacity: z.number(),
          active: z.number(),
          queued: z.number(),
          freeCapacity: z.number(),
          slotCount: z.number(),
        })
        .strict(),
    ),
    platforms: z.array(
      z
        .object({
          platform: z.enum(["android", "ios", "browser"]),
          scheduledSlots: z.number(),
          excludedTargets: z.number(),
          workItems: z.number().optional(),
          serial: timeEstimateSchema.optional(),
          parallel: timeEstimateSchema.optional(),
          budget: budgetSchema.optional(),
        })
        .strict(),
    ),
    serial: timeEstimateSchema,
    parallel: timeEstimateSchema.extend({ idealSpeedup: z.number().nullable() }),
    budget: budgetSchema.optional(),
    assumptions: z.array(z.string()),
  })
  .strict();

export const localCampaignCapacityPreflightSchema: z.ZodType<LocalCampaignCapacityPreflight> = z
  .object({
    checkedAt: z.number(),
    input: z
      .object({
        targets: z.array(z.object({ targetId: z.string(), platform }).strict()),
        workItems: z.number(),
        workItemsByPlatform: z.partialRecord(platform, z.number()),
        duration: durationInputSchema,
        deadlineMs: z.number(),
        setupHeadroomMs: z.number().optional(),
        recoveryHeadroomMs: z.number().optional(),
      })
      .strict(),
    duration: durationInputSchema.extend({
      assurance: z.enum(["measured-current", "measurement-stale", "supplied-estimate"]),
    }),
    targets: z.array(targetFactSchema),
    deadline: deadlineSchema,
    plan: campaignPlanSchema,
    assumptions: z.array(z.string()),
  })
  .strict();

export const localCampaignTargetPreflightSchema: z.ZodType<LocalCampaignCapacityTargetCriticalPathPreflight> =
  z
    .object({
      checkedAt: z.number(),
      target: targetFactSchema,
      criticalPath: z
        .object({
          workItems: z.array(
            z.object({ workItemId: z.string(), evidence: durationEvidenceSchema }).strict(),
          ),
          estimatedWorkDurationMs: z.number(),
        })
        .strict(),
      scheduled: z.boolean(),
      deadline: deadlineSchema,
      assumptions: z.array(z.string()),
    })
    .strict();

const localDeviceTargetSchema: z.ZodType<LocalAgentDeviceExecutionTargetRef> = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("local-device"),
    provider: z
      .object({ key: z.literal("relay.local.agent-device"), scope: z.literal("local") })
      .strict(),
    targetId: z.string(),
    platform: z.enum(["android", "ios"]),
    identity: z.object({ kind: z.literal("device-serial"), value: z.string() }).strict(),
  })
  .strict();

type CombineCampaignAdmission = NonNullable<
  NonNullable<CombineCampaign["execution"]>["localAdmission"]
>;

export const combineCampaignAdmissionSchema: z.ZodType<CombineCampaignAdmission> = z
  .object({
    request: localCampaignAdmissionRequestSchema,
    preflight: localCampaignCapacityPreflightSchema,
    targetPreflights: z.array(localCampaignTargetPreflightSchema).optional(),
    targets: z.array(localDeviceTargetSchema),
  })
  .strict();
