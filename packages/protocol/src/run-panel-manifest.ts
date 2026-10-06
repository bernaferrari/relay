import * as z from "zod/v4";
import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

const text = z.string().max(240);
const count = z.number().int().nonnegative();
const configuration = z
  .object({
    app: text.optional(),
    account: text.optional(),
    browser: text.optional(),
    viewport: text.optional(),
    locale: text.optional(),
    build: text.optional(),
  })
  .strict();
const coverage = z
  .object({
    planned: count,
    captured: count,
    blocked: count,
    missing: count,
    pending: count,
    accepted: count,
    issue: count,
    needMoreEvidence: count,
    unchanged: count.optional(),
    changed: count.optional(),
    new: count.optional(),
  })
  .strict();

/** Metadata only. Selected image bytes use the existing scoped Run artifact route. */
export const runPanelManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    run: z
      .object({
        id: text,
        name: text,
        status: text,
        outcome: text.optional(),
        startedAt: z.number().optional(),
        finishedAt: z.number().optional(),
        attempts: count,
        retryOf: text.optional(),
        retriedBy: text.optional(),
        sourceTest: z
          .object({
            appMapId: text,
            testId: text,
            appMapRevision: count,
            testRevision: count.optional(),
          })
          .strict()
          .optional(),
        repair: text.optional(),
        sourceRevision: z
          .object({
            vcs: z.literal("git"),
            sha: z.string().regex(/^[a-f0-9]{7,40}$/u),
            prNumber: count.optional(),
            branch: text.optional(),
            artifactDigest: text.optional(),
            buildId: text.optional(),
          })
          .strict()
          .optional(),
        review: z
          .object({ status: z.enum(["pending", "approved", "rejected"]), reason: text })
          .strict()
          .optional(),
        history: z
          .array(z.object({ title: text, status: text, heal: text.optional() }).strict())
          .max(20),
        historyCount: count,
      })
      .strict(),
    coverage,
    checks: z
      .object({
        passed: count,
        failed: count,
        needsReview: count,
        items: z.array(z.object({ title: text, status: text }).strict()).max(20),
        totalCount: count,
        truncated: z.boolean(),
      })
      .strict(),
    frames: z
      .object({
        offset: count,
        totalCount: count,
        nextOffset: count.optional(),
        truncated: z.boolean(),
        items: z
          .array(
            z
              .object({
                index: count,
                captureId: z.string().max(1024),
                caption: text,
                status: text,
                blocked: z.boolean(),
                file: z.string().max(240).optional(),
                attempt: count.optional(),
                iteration: count.optional(),
                phase: text.optional(),
                observed: z
                  .object({ laneId: text.optional(), profileId: text.optional() })
                  .strict()
                  .optional(),
                imageSha256: z
                  .string()
                  .regex(/^[a-f0-9]{64}$/u)
                  .optional(),
                configuration: configuration.optional(),
              })
              .strict(),
          )
          .max(40),
      })
      .strict(),
  })
  .strict();

export type RunPanelManifest = z.output<typeof runPanelManifestSchema>;
const { query } = createOperationBuilders<RelayOperationMap>();
export const runPanelManifestOperationDefinitions = [
  query("run.panel-manifest.get", "Read retained Run manifest", "/runs/:runId/panel-manifest", {
    category: "evidence",
    output: {
      description: "Bounded retained Run metadata",
      parse: (value) => z.object({ manifest: runPanelManifestSchema }).strict().parse(value),
    },
  }),
] as const;
