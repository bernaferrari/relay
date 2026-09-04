/** @jsxImportSource react */
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@relay/ui-react";
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
  | { label: string; to: "/tests" | "/runs" | "/changes" | "/devices" | "/home" }
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
              {"to" in item ? (
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
  return (
    <Alert
      className={`relay-recovery-state relay-recovery-state--${layout}${className ? ` ${className}` : ""}`}
      variant="danger"
      role="alert"
    >
      <AlertIcon>
        <CircleAlert />
      </AlertIcon>
      <div className="relay-recovery-state-copy">
        <AlertTitle>{title}</AlertTitle>
        {supportingText ? (
          <AlertDescription>
            <p>{supportingText}</p>
          </AlertDescription>
        ) : null}
      </div>
      {action ? <AlertActions>{action}</AlertActions> : null}
    </Alert>
  );
}

export function OutcomeMark({ outcome }: { outcome: string | undefined }) {
  const presentation = outcomePresentation(outcome);
  return (
    <span className={`relay-outcome-mark relay-outcome-mark--${presentation.tone}`}>
      <presentation.icon aria-hidden="true" />
      {presentation.label}
    </span>
  );
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
