import * as z from "zod/v4";

const revision = z
  .object({
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
    label: z.string().min(1).max(512),
  })
  .strict();

const baseCandidate = revision.extend({ ref: z.string().min(1).max(512) }).strict();

export const workspaceChangeContextSchema = z
  .object({
    status: z.enum(["resolved", "needs-selection", "unavailable"]),
    workspace: z
      .object({
        name: z.string().min(1).max(512),
      })
      .strict(),
    repository: z.string().min(1).max(512).optional(),
    branch: z.string().min(1).max(512).optional(),
    head: revision.optional(),
    base: revision.optional(),
    baseCandidates: z.array(baseCandidate).max(32),
    changedFileCount: z.number().int().nonnegative(),
    changedFiles: z.array(z.string().min(1).max(4096)).max(100),
    localChangeCount: z.number().int().nonnegative(),
    localChanges: z.array(z.string().min(1).max(4096)).max(100),
    readyForProof: z.boolean(),
    blockers: z.array(z.string().min(1).max(4096)).max(32),
  })
  .strict();

export type WorkspaceChangeContext = z.output<typeof workspaceChangeContextSchema>;
