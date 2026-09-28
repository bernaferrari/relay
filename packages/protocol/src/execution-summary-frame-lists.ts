import type { CaptureReviewItem } from "./capture-review.js";
import { destIdentityReviewItems } from "./capture-review.js";
import { analysisCaseFrames } from "./execution-summary-analysis.js";
import {
  listedDestIdentity,
  listedFramePath,
  listedFrames,
} from "./execution-summary-capture-review.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function comparisonListedFrames(value: unknown): { path: string; caption?: string }[] {
  const comparison = object(value);
  const latest = object(comparison?.latest);
  const approved = object(comparison?.approved);
  const baselineApproved = object(object(comparison?.baseline)?.approved);
  return [
    ...listedFrames(latest?.frames),
    ...listedFrames(approved?.frames),
    ...listedFrames(baselineApproved?.frames),
  ];
}

export function analysisListedFrames(value: unknown): { path: string; caption?: string }[] {
  return Array.isArray(value)
    ? value.flatMap((item) => analysisCaseFrames(object(item)?.frames))
    : [];
}

export function listedReviewFrames(value: unknown): { path: string; caption?: string }[] {
  const queue = object(value);
  const items = Array.isArray(queue?.items) ? queue.items : Array.isArray(value) ? value : [];
  return destIdentityReviewItems(
    items.flatMap((item) => {
      const record = object(item);
      return record ? [record as CaptureReviewItem] : [];
    }),
  ).flatMap((item) => {
    const path = listedFramePath(item.framePath) ?? listedFramePath(object(item)?.path);
    if (!path) return [];
    const caption = typeof item.caption === "string" ? item.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
}

export function findingsListedFrames(value: unknown): { path: string; caption?: string }[] {
  const findings = object(value);
  if (!findings) return [];
  const analysis = object(findings.analysis);
  return [
    ...listedDestIdentity(findings.destIdentity),
    ...analysisListedFrames(findings.cases),
    ...listedDestIdentity(analysis?.destIdentity),
    ...analysisListedFrames(analysis?.cases),
  ];
}

export function exportListedFrames(value: unknown): { path: string; caption?: string }[] {
  const exported = object(value);
  if (!exported) return [];
  const manifest = object(exported.manifest);
  return [
    ...listedDestIdentity(exported.destIdentity),
    ...listedDestIdentity(manifest?.destIdentity),
    ...analysisListedFrames(exported.cases),
    ...analysisListedFrames(manifest?.cases),
  ];
}
