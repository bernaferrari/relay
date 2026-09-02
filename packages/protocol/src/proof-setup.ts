import * as z from "zod/v4";
import { journeyAssociationSchema, verificationPlanSchema } from "./change-impact.js";
import {
  changeVerificationPolicySchema,
  frozenVerificationTargetCaseSchema,
} from "./change-verification.js";

const identifier = z.string().trim().min(1).max(256);
const exactGitSha = z.string().regex(/^[a-f0-9]{40}$/u);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const repositoryRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").some((segment) => segment === ".."),
    "must be a repository-relative path without parent traversal",
  );

export const proofSetupCommandSchema = z
  .object({
    executable: z.string().trim().min(1).max(512),
    args: z.array(z.string().max(4_096)).max(128).readonly(),
  })
  .strict();

const proofSetupBuildBaseSchema = z
  .object({
    id: identifier,
    name: identifier,
    platform: z.enum(["android", "ios", "web"]),
    command: proofSetupCommandSchema,
    artifactPath: repositoryRelativePath,
    configuration: identifier,
    environmentRevision: identifier,
    applicationId: identifier.optional(),
    webDeployment: z
      .object({ url: z.url().max(2_048), deploymentDigest: sha256 })
      .strict()
      .optional(),
  })
  .strict();

export const proofSetupBuildInputSchema = proofSetupBuildBaseSchema.superRefine(
  (build, context) => {
    if (build.platform === "web" && !build.webDeployment) {
      context.addIssue({
        code: "custom",
        path: ["webDeployment"],
        message: "is required for a provider-verified web build",
      });
    }
    if (build.platform !== "web" && build.webDeployment) {
      context.addIssue({
        code: "custom",
        path: ["webDeployment"],
        message: "is only valid for web builds",
      });
    }
  },
);

/** Reviewed, source-controlled instructions for producing one exact-head Build. */
export const proofBuildDefinitionSchema = proofSetupBuildInputSchema;

const proofSetupPreviewBuildSchema = proofSetupBuildBaseSchema
  .omit({ command: true, artifactPath: true })
  .superRefine((build, context) => {
    if (build.platform === "web" && !build.webDeployment) {
      context.addIssue({
        code: "custom",
        path: ["webDeployment"],
        message: "is required for a provider-verified web build",
      });
    }
    if (build.platform !== "web" && build.webDeployment) {
      context.addIssue({
        code: "custom",
        path: ["webDeployment"],
        message: "is only valid for web builds",
      });
    }
  });

export const proofSetupIntentSchema = z
  .object({
    baseRef: z.string().trim().min(1).max(512).optional(),
    /** Backward-compatible single-build setup input. */
    build: proofSetupBuildInputSchema.optional(),
    builds: z.array(proofSetupBuildInputSchema).min(1).max(32).readonly().optional(),
    associations: z.array(journeyAssociationSchema).min(1).max(2_048).readonly(),
    targetCases: z.array(frozenVerificationTargetCaseSchema).min(1).max(250).readonly(),
    policy: changeVerificationPolicySchema.optional(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (Boolean(intent.build) === Boolean(intent.builds)) {
      context.addIssue({
        code: "custom",
        path: ["builds"],
        message: "provide exactly one of build or builds",
      });
    }
    const builds = intent.builds ?? (intent.build ? [intent.build] : []);
    if (new Set(builds.map(({ id }) => id)).size !== builds.length) {
      context.addIssue({ code: "custom", path: ["builds"], message: "build ids must be unique" });
    }
  });

const proofSetupPolicyDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    repository: z.string().trim().min(1).max(1_024),
    changed: z.object({}).strict(),
    associations: z.array(journeyAssociationSchema).min(1).max(2_048).readonly(),
    buildDefinitions: z.array(proofBuildDefinitionSchema).min(1).max(32).readonly(),
    builds: z
      .array(
        z
          .object({
            id: identifier,
            platform: z.enum(["android", "ios", "web"]),
            artifactDigest: sha256,
            sourceSha: exactGitSha,
            configuration: identifier,
            environmentRevision: identifier,
          })
          .strict(),
      )
      .min(1)
      .max(32)
      .readonly(),
    targetCases: z.array(frozenVerificationTargetCaseSchema).min(1).max(250).readonly(),
    policy: changeVerificationPolicySchema,
  })
  .strict()
  .superRefine((document, context) => {
    for (const [path, values] of [
      ["buildDefinitions", document.buildDefinitions],
      ["builds", document.builds],
    ] as const) {
      if (new Set(values.map(({ id }) => id)).size !== values.length) {
        context.addIssue({ code: "custom", path: [path], message: "build ids must be unique" });
      }
    }
  });

const proofSetupArtifactSchema = z
  .object({
    path: repositoryRelativePath,
    digest: sha256,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const proofSetupPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseRef: z.string().trim().min(1).max(512).optional(),
    testedSha: exactGitSha,
    command: proofSetupCommandSchema,
    artifact: proofSetupArtifactSchema,
    build: proofSetupPreviewBuildSchema,
    /** Added in schemaVersion 1 as an additive multi-build extension. */
    commands: z.array(proofSetupCommandSchema).min(1).max(32).readonly().optional(),
    artifacts: z.array(proofSetupArtifactSchema).min(1).max(32).readonly().optional(),
    builds: z.array(proofSetupPreviewBuildSchema).min(1).max(32).readonly().optional(),
    policy: z
      .object({
        path: z.literal(".relay/change-proof.json"),
        document: proofSetupPolicyDocumentSchema,
        digest: sha256,
        previousDigest: sha256.nullable(),
      })
      .strict(),
    previewDigest: sha256,
  })
  .strict();

export const proofSetupOperationInputSchemas = {
  "proof.setup.inspect": z
    .object({ baseRef: z.string().trim().min(1).max(512).optional() })
    .strict(),
  "proof.setup.preview": proofSetupIntentSchema,
  "proof.setup.apply": proofSetupPreviewSchema.extend({ confirm: z.literal(true) }).strict(),
} as const;

const discoveryCandidate = z
  .object({ executable: z.string(), args: z.array(z.string()).readonly(), source: z.string() })
  .strict();

export const proofSetupOperationOutputSchemas = {
  "proof.setup.inspect": z
    .object({
      schemaVersion: z.literal(1),
      change: z
        .object({
          repository: z.string(),
          testedSha: exactGitSha,
          changedFiles: z.array(z.string()).readonly(),
        })
        .strict(),
      policy: z
        .object({ path: z.literal(".relay/change-proof.json"), digest: sha256.nullable() })
        .strict(),
      candidates: z
        .object({
          commands: z.array(discoveryCandidate).readonly(),
          artifacts: z
            .array(
              z
                .object({
                  path: repositoryRelativePath,
                  platform: z.enum(["android", "ios", "web"]),
                })
                .strict(),
            )
            .readonly(),
          tests: z
            .array(
              z.object({ appMapId: identifier, testId: identifier, name: z.string() }).strict(),
            )
            .readonly(),
          targets: z
            .array(
              z
                .object({
                  targetId: identifier,
                  profileId: identifier,
                  name: identifier,
                  platform: z.enum(["android", "ios", "browser"]),
                  targetCase: frozenVerificationTargetCaseSchema,
                })
                .strict(),
            )
            .readonly(),
        })
        .strict(),
      requiredFields: z.array(z.string()).readonly(),
    })
    .strict(),
  "proof.setup.preview": proofSetupPreviewSchema,
  "proof.setup.apply": z
    .object({
      preview: proofSetupPreviewSchema,
      registeredBuild: z
        .object({
          id: identifier,
          sourceSha: exactGitSha,
          sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
          status: z.literal("ready"),
        })
        .strict(),
      registeredBuilds: z
        .array(
          z
            .object({
              id: identifier,
              sourceSha: exactGitSha,
              sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
              status: z.literal("ready"),
            })
            .strict(),
        )
        .min(1)
        .max(32)
        .readonly()
        .optional(),
      plan: verificationPlanSchema,
      blockers: z.array(z.string()).readonly(),
    })
    .strict(),
} as const;

export type ProofSetupIntent = z.output<typeof proofSetupIntentSchema>;
export type ProofSetupPreview = z.output<typeof proofSetupPreviewSchema>;
export type ProofBuildDefinition = z.output<typeof proofBuildDefinitionSchema>;
