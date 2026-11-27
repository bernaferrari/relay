import * as z from "zod/v4";
import { savedSignInKeySchema } from "../sign-in/saved-sign-in.js";

/** Inbox is intentionally a small discriminated step shape. Phase 3 can widen
 * `action` without changing account/inbox addressing or metadata. */
export function createInboxStepSchema(metadataShape: Record<string, z.ZodTypeAny>) {
  return z
    .object({
      ...metadataShape,
      kind: z.literal("inbox"),
      action: z.enum(["type-code", "open-link"]),
      accountKey: savedSignInKeySchema.optional(),
      inboxKey: savedSignInKeySchema.optional(),
      timeoutMs: z.number().optional(),
    })
    .strict();
}
