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
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
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

type BreadcrumbItem =
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
  | { label: string };

export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  return (
    <nav className="relay-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}:${index}`}>
              {index ? (
                <ChevronRight className="relay-breadcrumb-separator" aria-hidden="true" />
              ) : null}
              {"to" in item && item.to === "/apps/$appId" ? (
                <Link to={item.to} params={item.params}>
                  {item.label}
                </Link>
              ) : "to" in item ? (
                <Link to={item.to}>{item.label}</Link>
              ) : (
                <span aria-current={current ? "page" : undefined}>{item.label}</span>
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
    <Empty className={`relay-empty-state relay-empty-state--${tone} relay-empty-state--${layout}`}>
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
        className={`relay-recovery-state relay-recovery-state--centered${className ? ` ${className}` : ""}`}
        role="alert"
      >
        <EmptyHeader>
          <EmptyMedia>
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
    <Alert
      className={`relay-recovery-state relay-recovery-state--compact${className ? ` ${className}` : ""}`}
      variant="destructive"
      role="alert"
    >
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      {supportingText ? (
        <AlertDescription>
          <p>{supportingText}</p>
        </AlertDescription>
      ) : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}

export function OutcomeMark({ outcome }: { outcome: string | undefined }) {
  const presentation = outcomePresentation(outcome);
  return (
    <Badge
      className={`relay-outcome-mark ${outcomeBadgeClass(presentation.tone)}`}
      variant={outcomeBadgeVariant(presentation.tone)}
    >
      <presentation.icon aria-hidden="true" />
      {presentation.label}
    </Badge>
  );
}

function outcomeBadgeVariant(tone: ReturnType<typeof outcomePresentation>["tone"]): "default" | "secondary" | "destructive" {
  if (tone === "danger") return "destructive";
  if (tone === "success") return "default";
  return "secondary";
}

function outcomeBadgeClass(tone: ReturnType<typeof outcomePresentation>["tone"]): string {
  if (tone === "success") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (tone === "notice") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "";
}

function outcomePresentation(outcome: string | undefined): {
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
  if (outcome === "needs-review") {
    return { label: "Needs review", icon: CircleHelp, tone: "notice" };
  }
  if (outcome === "queued") return { label: "Queued", icon: CircleDashed, tone: "quiet" };
  if (outcome === "running") return { label: "Running", icon: CircleDashed, tone: "quiet" };
  if (outcome === "completed") return { label: "Completed", icon: Check, tone: "success" };
  return { label: "In progress", icon: CircleDashed, tone: "quiet" };
}
