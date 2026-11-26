import * as z from "zod/v4";

/**
 * Schemas and compatibility helpers for the source change and its build
 * inputs. Keeping these together makes the durable Proof schema easier to
 * audit: this module owns revision identity, while the parent module owns
 * lifecycle state and validation.
 */

const identifier = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(4_096);
const exactGitSha = z
  .string()
  .regex(/^[a-f0-9]{40}$/u, "must be one exact 40-character lowercase Git SHA");
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

/**
 * Provider-neutral identity for the source change a Proof evaluates.
 *
 * `requestedHeadSha` is the revision the caller asked Relay to verify.  The
 * revision actually installed and exercised is `testedSha`; these are equal
 * for an ordinary commit Proof but intentionally differ for merge commits and
 * merge groups.  `baseSha`/`headSha` remain the compatibility projection used
 * by pre-ChangeRef callers (merge base and tested revision respectively).
 */
export const changeRefSchema = z
  .object({
    baseTipSha: exactGitSha,
    mergeBaseSha: exactGitSha,
    requestedHeadSha: exactGitSha,
    testedSha: exactGitSha,
    testedKind: z.enum(["head", "merge-commit", "merge-group"]),
    previousHeadSha: exactGitSha.optional(),
    targetBranch: identifier.optional(),
    repositoryId: identifier.optional(),
    provider: identifier.optional(),
    mergeGroupId: identifier.optional(),
  })
  .strict()
  .superRefine((change, context) => {
    if (change.mergeBaseSha === change.testedSha) {
      context.addIssue({
        code: "custom",
        path: ["testedSha"],
        message: "mergeBaseSha and testedSha must identify a change",
      });
    }
    if (change.testedKind === "head" && change.testedSha !== change.requestedHeadSha) {
      context.addIssue({
        code: "custom",
        path: ["testedSha"],
        message: "head Proofs must test requestedHeadSha",
      });
    }
    if (change.testedKind === "merge-group" && !change.mergeGroupId) {
      context.addIssue({
        code: "custom",
        path: ["mergeGroupId"],
        message: "merge-group Proofs require mergeGroupId",
      });
    }
    if (change.previousHeadSha === change.testedSha) {
      context.addIssue({
        code: "custom",
        path: ["previousHeadSha"],
        message: "previousHeadSha must differ from testedSha",
      });
    }
  });

export type ChangeRef = z.output<typeof changeRefSchema>;

function normalizeChangeInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  // A provider-neutral ChangeRef does not need the legacy repository/base/head
  // projection. Add it only at the schema boundary so old consumers retain a
  // stable shape while the durable document still records canonical fields.
  if (
    typeof input.baseSha !== "string" &&
    typeof input.mergeBaseSha === "string" &&
    typeof input.testedSha === "string"
  ) {
    return {
      ...input,
      repository:
        typeof input.repository === "string"
          ? input.repository
          : typeof input.repositoryId === "string"
            ? input.repositoryId
            : undefined,
      baseSha: input.mergeBaseSha,
      headSha: input.testedSha,
    };
  }
  // A legacy caller may spread a canonical ChangeRef and then replace only
  // baseSha/headSha (the historical replacement idiom). Treat those aliases
  // as the caller's complete legacy intent and rebuild the canonical fields;
  // this keeps old mutation payloads usable without allowing two identities to
  // coexist in a durable document.
  if (
    typeof input.baseSha === "string" &&
    typeof input.headSha === "string" &&
    typeof input.mergeBaseSha === "string" &&
    typeof input.testedSha === "string" &&
    (input.baseSha !== input.mergeBaseSha || input.headSha !== input.testedSha)
  ) {
    return {
      ...input,
      baseTipSha: input.baseSha,
      mergeBaseSha: input.baseSha,
      requestedHeadSha:
        input.testedKind === "head" ? input.headSha : (input.requestedHeadSha ?? input.headSha),
      testedSha: input.headSha,
    };
  }
  return value;
}

export const changeVerificationChangeSchema = z
  .preprocess(
    normalizeChangeInput,
    z
      .object({
        repository: z.string().trim().min(1).max(512),
        baseSha: exactGitSha,
        headSha: exactGitSha,
        /** Canonical ChangeRef fields. They are optional only for legacy durable
         * documents; server-created Proofs materialize all of them. */
        baseTipSha: exactGitSha.optional(),
        mergeBaseSha: exactGitSha.optional(),
        requestedHeadSha: exactGitSha.optional(),
        testedSha: exactGitSha.optional(),
        testedKind: z.enum(["head", "merge-commit", "merge-group"]).optional(),
        previousHeadSha: exactGitSha.optional(),
        targetBranch: identifier.optional(),
        repositoryId: identifier.optional(),
        provider: identifier.optional(),
        mergeGroupId: identifier.optional(),
        pullRequest: z.number().int().positive().optional(),
        agentClaim: z
          .object({
            summary: boundedText,
            acceptanceCriteria: z.array(boundedText).max(64).readonly(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  )
  .superRefine((change, context) => {
    if (change.baseSha === change.headSha) {
      context.addIssue({ code: "custom", message: "baseSha and headSha must identify a change" });
    }
    const canonicalFields = [
      change.baseTipSha,
      change.mergeBaseSha,
      change.requestedHeadSha,
      change.testedSha,
      change.testedKind,
    ];
    if (canonicalFields.some((value) => value !== undefined)) {
      if (canonicalFields.some((value) => value === undefined)) {
        context.addIssue({
          code: "custom",
          message:
            "baseTipSha, mergeBaseSha, requestedHeadSha, testedSha, and testedKind must be frozen together",
        });
        return;
      }
      if (change.baseSha !== change.mergeBaseSha) {
        context.addIssue({
          code: "custom",
          path: ["baseSha"],
          message: "compatibility baseSha must equal mergeBaseSha",
        });
      }
      if (change.headSha !== change.testedSha) {
        context.addIssue({
          code: "custom",
          path: ["headSha"],
          message: "compatibility headSha must equal testedSha",
        });
      }
      if (change.mergeBaseSha === change.testedSha) {
        context.addIssue({
          code: "custom",
          path: ["testedSha"],
          message: "mergeBaseSha and testedSha must identify a change",
        });
      }
      if (change.testedKind === "head" && change.testedSha !== change.requestedHeadSha) {
        context.addIssue({
          code: "custom",
          path: ["testedSha"],
          message: "head Proofs must test requestedHeadSha",
        });
      }
      if (change.testedKind === "merge-group" && !change.mergeGroupId) {
        context.addIssue({
          code: "custom",
          path: ["mergeGroupId"],
          message: "merge-group Proofs require mergeGroupId",
        });
      }
    }
  });

export type ChangeVerificationChange = z.output<typeof changeVerificationChangeSchema>;

/** Return the exact revision that must be installed, run, and published.
 * Legacy ChangeRefs used `headSha` for this value. */
export function changeTestedSha(
  change: Pick<ChangeVerificationChange, "headSha" | "testedSha">,
): string {
  return change.testedSha ?? change.headSha;
}

/** Return the caller-requested revision. Legacy callers had no separate
 * requested/tested distinction, so their head is the requested head too. */
export function changeRequestedHeadSha(
  change: Pick<ChangeVerificationChange, "headSha" | "requestedHeadSha">,
): string {
  return change.requestedHeadSha ?? change.headSha;
}

export function changeMergeBaseSha(
  change: Pick<ChangeVerificationChange, "baseSha" | "mergeBaseSha">,
): string {
  return change.mergeBaseSha ?? change.baseSha;
}

/** Canonicalize a caller's ChangeRef before it becomes a durable Proof. The
 * legacy projection is retained byte-for-byte in field names so old clients
 * continue to consume the document, while newly created Proofs always freeze
 * every ChangeRef component. */
export function materializeChangeRef(value: unknown): ChangeVerificationChange & ChangeRef {
  const parsed = changeVerificationChangeSchema.parse(value);
  const baseTipSha = parsed.baseTipSha ?? parsed.baseSha;
  const mergeBaseSha = parsed.mergeBaseSha ?? parsed.baseSha;
  const requestedHeadSha = parsed.requestedHeadSha ?? parsed.headSha;
  const testedSha = parsed.testedSha ?? parsed.headSha;
  const testedKind = parsed.testedKind ?? "head";
  const canonical = changeRefSchema.parse({
    baseTipSha,
    mergeBaseSha,
    requestedHeadSha,
    testedSha,
    testedKind,
    ...(parsed.previousHeadSha ? { previousHeadSha: parsed.previousHeadSha } : {}),
    ...(parsed.targetBranch ? { targetBranch: parsed.targetBranch } : {}),
    ...(parsed.repositoryId ? { repositoryId: parsed.repositoryId } : {}),
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.mergeGroupId ? { mergeGroupId: parsed.mergeGroupId } : {}),
  });
  return {
    ...parsed,
    baseSha: canonical.mergeBaseSha,
    headSha: canonical.testedSha,
    ...canonical,
  } as ChangeVerificationChange & ChangeRef;
}

export const changeVerificationBuildSchema = z
  .object({
    id: identifier,
    platform: z.enum(["web", "android", "ios"]),
    artifactDigest: sha256,
    sourceSha: exactGitSha,
    configuration: identifier,
    environmentRevision: identifier,
  })
  .strict();

export const changeVerificationAffectedJourneySchema = z
  .object({
    appMapId: identifier,
    testId: identifier,
    /** Exact reviewed App Map revision. Historical/planning documents may
     * omit it, but live execution requires it before target control. */
    appMapRevision: z.number().int().positive().optional(),
    reason: boundedText,
    confidence: z.enum(["definite", "probable", "coverage-gap"]),
  })
  .strict();
