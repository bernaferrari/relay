/** @jsxImportSource react */
import type { ProductAffectedTest, ProductVerificationItem } from "@relay/product/change-journey";
import { Link } from "@tanstack/react-router";
import type { ProductChangeDetail } from "../data/change-product-service";

export function AffectedTest({
  test,
  detail,
}: {
  test: ProductAffectedTest;
  detail: ProductChangeDetail;
}) {
  const name = detail.names.tests[`${test.appId}:${test.testId}`] ?? humanize(test.testId);
  const app = detail.names.apps[test.appId] ?? humanize(test.appId);
  return (
    <li className="grid grid-cols-[minmax(170px,.42fr)_minmax(220px,1fr)_auto] items-center gap-6 border-b border-border py-3 last:border-b-0 max-[780px]:grid-cols-1">
      <div className="grid min-w-0 gap-1">
        <Link to="/tests/$testId" params={{ testId: test.testId }}>
          {name}
        </Link>
        <span className="text-xs text-muted-foreground">{app}</span>
      </div>
      <p className="max-w-[62ch] text-xs leading-5 text-muted-foreground">{test.reason}</p>
      <span className="inline-flex min-h-7 items-center rounded-full border border-border bg-muted px-2 text-xs font-medium text-muted-foreground">
        {confidenceLabel(test.confidence)}
      </span>
    </li>
  );
}

export function VerificationItem({
  item,
  detail,
}: {
  item: ProductVerificationItem;
  detail: ProductChangeDetail;
}) {
  const test = detail.names.tests[`${item.appId}:${item.testId}`] ?? humanize(item.testId);
  return (
    <li className="relay-verification-item rounded-lg border border-border bg-muted/30 p-4">
      <div className="relay-verification-item-head flex items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <strong className="truncate text-sm font-semibold text-foreground">{test}</strong>
          <span className="text-xs text-muted-foreground">
            {item.targetName} · {platformLabel(item.platform)}
          </span>
        </div>
        <div className="relay-verification-tags flex flex-wrap justify-end gap-1.5">
          {item.pilot ? (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              Pilot
            </span>
          ) : null}
          <span className="rounded-full border border-border px-2 py-1 text-xs font-medium text-muted-foreground">
            {item.requirement === "required" ? "Required" : "Advisory"}
          </span>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{item.reason}</p>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 max-[520px]:grid-cols-1">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Build
          </dt>
          <dd className="mt-1 text-xs text-foreground">{humanize(item.buildName)}</dd>
        </div>
        {item.estimatedDurationMs ? (
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Expected time
            </dt>
            <dd className="mt-1 text-xs text-foreground">
              {formatDuration(item.estimatedDurationMs)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cleanup
          </dt>
          <dd className="mt-1 text-xs text-foreground">
            {item.cleanupRequired ? "Verified after the Test" : "Not required"}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function humanize(value: string): string {
  const spaced = value
    .replaceAll(/[-_.]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : "Unnamed";
}

function confidenceLabel(value: ProductAffectedTest["confidence"]): string {
  if (value === "definite") return "Directly affected";
  if (value === "probable") return "Likely affected";
  return "Coverage gap";
}

function platformLabel(platform: ProductVerificationItem["platform"]): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Browser";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 100) / 10} s`;
  return `${Math.round(durationMs / 60_000)} min`;
}
