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
      className="relay-breadcrumbs text-[11px] leading-4 text-muted-foreground"
      aria-label="Breadcrumb"
    >
      <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li className="inline-flex min-w-0 items-center gap-1.5" key={`${item.label}:${index}`}>
              {index ? (
                <ChevronRight
                  className="relay-breadcrumb-separator size-3 shrink-0 text-[var(--text-weaker)]"
                  aria-hidden="true"
                />
              ) : null}
              {"to" in item && (item.to === "/apps/$appId" || item.to === "/tests/$testId") ? (
                <Link
                  className="inline-flex items-center text-[var(--text-weak)] hover:text-foreground"
                  to={item.to}
                  params={item.params}
                >
                  {item.label}
                </Link>
              ) : "to" in item ? (
                <Link
                  className="inline-flex items-center text-[var(--text-weak)] hover:text-foreground"
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
        "relay-empty-state",
        tone === "notice" ? "relay-empty-state--notice" : "relay-empty-state--quiet",
        layout === "filtered" ? "relay-empty-state--filtered" : "relay-empty-state--default",
      )}
    >
      <EmptyHeader>
        <EmptyMedia>
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent className="relay-empty-state-action">{action}</EmptyContent> : null}
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
      <Empty
        className={classNames("relay-recovery-state", "relay-recovery-state--centered", className)}
        role="alert"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlert />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          {supportingText ? <EmptyDescription>{supportingText}</EmptyDescription> : null}
        </EmptyHeader>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
      </Empty>
    );
  }

  return (
    <section
      className={`relay-recovery-state relay-recovery-state--compact max-w-[60ch]${className ? ` ${className}` : ""}`}
      role="alert"
    >
      <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
      {supportingText ? (
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{supportingText}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
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
        "relay-readiness-mark",
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
