import { createHash } from "node:crypto";
import type { CombineEvidenceCapture } from "./combine-evidence-batch-analysis.js";

/** Geometry and generated node IDs are not translation identity. Preserve
 * ordering and repetitions: repeated amounts or words can be meaningful. */
export function capturedText(capture: CombineEvidenceCapture): string | undefined {
  if (!capture.nodes?.length) return undefined;
  const text = capture.nodes
    .map((node) => node.content || node.label || node.value || "")
    .map((value) => String(value).normalize("NFC").replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

export function compareCapturedContent(captures: CombineEvidenceCapture[]) {
  const pages = captures.map((capture) => {
    const text = capturedText(capture);
    return {
      path: capture.packPath,
      jobId: capture.jobId,
      locale: capture.locale,
      canonicalKey: `frame-${String(capture.index + 1).padStart(3, "0")}`,
      screenshotSha256: capture.sha256,
      ...(text ? { text, textSha256: createHash("sha256").update(text).digest("hex") } : {}),
    };
  });
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.textSha256) continue;
    const key = `${page.canonicalKey}:${page.textSha256}`;
    groups.set(key, [...(groups.get(key) ?? []), page.path]);
  }
  return {
    method: "ordered-nfc-text-v1" as const,
    inspectedPages: pages.filter((page) => page.textSha256).length,
    uniquePages: groups.size,
    duplicateGroups: [...groups.values()].filter((paths) => paths.length > 1),
    pages,
  };
}
