/** @jsxImportSource react */
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@relay/ui-react/components/empty";
import { Badge } from "@relay/ui-react/components/badge";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  ListChecks,
  Minus,
  CircleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { RunOutcome } from "@relay/protocol";
import { productTestStatusLabel, type ProductRunPhase } from "@relay/product/catalog";
import { classNames } from "../lib/class-names";

type OutcomeValue = RunOutcome | ProductRunPhase | undefined;
type ReadinessValue = "ready" | "needs-review";

export type BreadcrumbItem =
  | {
      label: string;
      to:
        | "/apps"
        | "/tests"
        | "/suites"
        | "/environments"
        | "/sessions"
        | "/runs"
        | "/changes"
        | "/devices"
        | "/home";
    }
  | { label: string; to: "/apps/$appId"; params: { appId: string } }
  | { label: string; to: "/tests/$testId"; params: { testId: string } }
  | { label: string };

export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  return (
    <nav
      className="relay-breadcrumbs text-xs leading-4 text-muted-foreground"
      aria-label="Breadcrumb"
    >
      <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li className="inline-flex min-w-0 items-center gap-1.5" key={`${item.label}:${index}`}>
              {index ? (
                <ChevronRight
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              {"to" in item && (item.to === "/apps/$appId" || item.to === "/tests/$testId") ? (
                <Link
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  to={item.to}
                  params={item.params}
                >
                  {item.label}
                </Link>
              ) : "to" in item ? (
                <Link
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  to={item.to}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className="overflow-hidden text-ellipsis whitespace-nowrap"
                  aria-current={current ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  tone = "quiet",
  layout = "default",
  icon: Icon = ListChecks,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
  tone?: "quiet" | "notice";
  layout?: "default" | "filtered";
  icon?: LucideIcon;
}) {
  return (
    <Empty
      className={classNames(
        "",
        tone === "notice" ? "" : "",
        layout === "filtered" ? "relay-empty-state--filtered" : "",
      )}
    >
      <EmptyHeader>
        <EmptyMedia>
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function RecoveryState({
  title,
  detail,
  recovery,
  action,
  layout = "compact",
  className,
}: {
  title: string;
  detail?: string;
  recovery?: string;
  action?: ReactNode;
  layout?: "compact" | "centered";
  className?: string;
}) {
  const supportingText = detail ?? recovery;

  if (layout === "centered") {
    return (
      <section
        className={classNames(
          " relay-recovery-state--centered flex min-w-0 flex-1 items-center justify-center px-5 py-10",
          className,
        )}
        role="alert"
      >
        <div className="flex w-full max-w-sm items-start gap-4 rounded-2xl border border-border/60 bg-muted/25 p-5 sm:p-6">
          <CircleAlert
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="grid min-w-0 flex-1 gap-4">
            <div className="grid gap-1.5">
              <h2 className="text-base font-medium leading-snug text-foreground">{title}</h2>
              {supportingText ? (
                <p className="max-w-[30ch] text-sm leading-relaxed text-muted-foreground">
                  {supportingText}
                </p>
              ) : null}
            </div>
            {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={classNames(
        " flex shrink-0 items-start gap-3 rounded-xl border border-border bg-muted/40 p-4",
        className,
      )}
      role="alert"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {supportingText ? (
            <p className="mt-1 max-w-prose text-sm leading-5 text-muted-foreground">
              {supportingText}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </section>
  );
}

export function OutcomeMark({ outcome }: { outcome: OutcomeValue }) {
  const presentation = outcomePresentation(outcome);
  return (
    <Badge
      className={classNames(
        "relay-outcome-mark",
        presentation.tone === "success" &&
          "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
        presentation.tone === "notice" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
      )}
      variant={outcomeBadgeVariant(presentation.tone)}
    >
      <presentation.icon aria-hidden="true" />
      {presentation.label}
    </Badge>
  );
}

export function ReadinessMark({ status, name }: { status: ReadinessValue; name?: string }) {
  const label = productTestStatusLabel(status, name);
  const presentation =
    label === "Ready"
      ? { label, icon: ListChecks, tone: "quiet" as const }
      : { label, icon: CircleHelp, tone: "notice" as const };
  return (
    <Badge
      className={classNames(
        "",
        presentation.tone === "notice" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
      )}
      variant={outcomeBadgeVariant(presentation.tone)}
    >
      <presentation.icon aria-hidden="true" />
      {presentation.label}
    </Badge>
  );
}

function outcomeBadgeVariant(
  tone: ReturnType<typeof outcomePresentation>["tone"],
): "default" | "secondary" | "destructive" {
  if (tone === "danger") return "destructive";
  if (tone === "success") return "default";
  return "secondary";
}

function outcomePresentation(outcome: OutcomeValue): {
  label: string;
  icon: LucideIcon;
  tone: "success" | "danger" | "notice" | "quiet";
} {
  if (outcome === "passed") return { label: "Passed", icon: Check, tone: "success" };
  if (outcome === "product-failure") {
    return { label: "Product issue", icon: X, tone: "danger" };
  }
  if (outcome === "harness-failure") {
    return { label: "Could not complete", icon: AlertTriangle, tone: "notice" };
  }
  if (outcome === "uncertain") {
    return { label: "Needs review", icon: CircleHelp, tone: "notice" };
  }
  if (outcome === "cancelled") return { label: "Cancelled", icon: Minus, tone: "quiet" };
  if (outcome === "failed") return { label: "Failed", icon: X, tone: "danger" };
  if (outcome === "queued") return { label: "Queued", icon: CircleDashed, tone: "quiet" };
  if (outcome === "running") return { label: "Running", icon: CircleDashed, tone: "quiet" };
  if (outcome === "completed") return { label: "Completed", icon: Check, tone: "success" };
  return { label: "Unknown result", icon: CircleHelp, tone: "notice" };
}
