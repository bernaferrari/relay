import type { PlanCaptureReviewItem, PlanCaptureReviewQueue } from "@relay/protocol";
import { summarizePlanCaptureReview } from "@relay/protocol";

const steps = [
  "Open cart",
  "Tap “Checkout”",
  "Type shipping address",
  "Choose delivery",
  "Tap “Pay now”",
  "Order confirmation",
] as const;

const accounts = ["Guest", "Member", "Admin"] as const;

let current: PlanCaptureReviewQueue | undefined;

/** Plan screenshot queue for the batch fixture, keeping decisions for the page's lifetime. */
export function planCaptureQueue(): PlanCaptureReviewQueue {
  current ??= initialQueue();
  return structuredClone(current);
}

export function reviewPlanCaptures(input: {
  action: string;
  items: { runId: string; captureId: string; note?: string }[];
}) {
  const queue = (current ??= initialQueue());
  const status: PlanCaptureReviewItem["status"] =
    input.action === "report-issue"
      ? "issue"
      : input.action === "need-more-evidence"
        ? "need-more-evidence"
        : "accepted";
  for (const target of input.items) {
    const item = queue.items.find(
      (entry) => entry.runId === target.runId && entry.captureId === target.captureId,
    );
    if (!item) continue;
    item.status = status;
    if (target.note) item.note = target.note;
  }
  current = { items: queue.items, summary: summarizePlanCaptureReview(queue.items) };
  return { results: input.items.map((item) => ({ ...item, status: "applied" as const })) };
}

function initialQueue(): PlanCaptureReviewQueue {
  const items: PlanCaptureReviewItem[] = [];
  accounts.forEach((account, caseIndex) => {
    steps.forEach((step, stepIndex) => {
      const frame = `frames/${caseIndex}-${stepIndex}.png`;
      const failed = account === "Member" && stepIndex === steps.length - 1;
      const status: PlanCaptureReviewItem["status"] = failed
        ? "missing"
        : account === "Guest" && stepIndex < 3
          ? "accepted"
          : account === "Admin" && stepIndex === 2
            ? "issue"
            : "pending";
      items.push({
        runId: `batch-run-${caseIndex * 2 + 1}`,
        executionCaseId: `case-${caseIndex * 2 + 1}`,
        captureId: `${frame}::${caseIndex}${stepIndex}`,
        caption: step,
        status,
        ...(status === "missing"
          ? {}
          : { framePath: frame, imageSha256: `${caseIndex}${stepIndex}` }),
        ...(status === "issue" ? { note: "Address field overlaps the keyboard." } : {}),
        ...(stepIndex === 5 ? { lookFor: "Order number is visible" } : {}),
        device: "Pixel 9",
        account,
      });
    });
  });
  return { items, summary: summarizePlanCaptureReview(items) };
}

const palette = ["#2563eb", "#7c3aed", "#0891b2", "#16a34a", "#ea580c", "#db2777"];

/** A small phone-shaped SVG standing in for a captured frame. */
export function planCaptureSvg(path: string): string {
  const match = /frames\/(\d+)-(\d+)\.png/u.exec(path);
  const caseIndex = Number(match?.[1] ?? 0);
  const stepIndex = Number(match?.[2] ?? 0);
  const color = palette[stepIndex % palette.length];
  const title = steps[stepIndex] ?? "Screen";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="780" viewBox="0 0 360 780">
<rect width="360" height="780" fill="#0b0b0f"/>
<text x="24" y="40" fill="#e5e7eb" font-family="system-ui" font-size="16">12:0${stepIndex}</text>
<rect x="24" y="80" width="312" height="56" rx="14" fill="#1f2937"/>
<text x="44" y="115" fill="#f9fafb" font-family="system-ui" font-size="18" font-weight="600">${title.replace(/[“”]/gu, '"')}</text>
<rect x="24" y="160" width="312" height="220" rx="18" fill="${color}"/>
<text x="44" y="420" fill="#9ca3af" font-family="system-ui" font-size="15">${accounts[caseIndex]} account</text>
<rect x="24" y="450" width="220" height="14" rx="7" fill="#374151"/>
<rect x="24" y="480" width="260" height="14" rx="7" fill="#374151"/>
<rect x="24" y="510" width="180" height="14" rx="7" fill="#374151"/>
<rect x="24" y="690" width="312" height="52" rx="26" fill="#f9fafb"/>
<text x="180" y="723" fill="#111827" font-family="system-ui" font-size="17" text-anchor="middle" font-weight="600">Continue</text>
</svg>`;
}
