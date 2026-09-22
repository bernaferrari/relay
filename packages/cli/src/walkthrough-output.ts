import { walkthroughHtml, walkthroughPackExportResponseSchema } from "@relay/protocol";

/** Human CLI output is the passive page. `--json` keeps the structured pack. */
export function formatWalkthroughPackResult(value: unknown): string | undefined {
  const parsed = walkthroughPackExportResponseSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return walkthroughHtml(parsed.data);
}
