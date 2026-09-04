/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@relay/ui-react/components/item";
import { type ReactNode } from "react";
import type { SensitiveEvidenceChannel } from "@relay/protocol";

export type SetupCheck = { id: string; label: string; status: string; detail: string };

export const CONNECTION_QUERY_KEY = ["settings", "connection"] as const;

export const CHANNELS: readonly {
  id: SensitiveEvidenceChannel;
  label: string;
  description: string;
}[] = [
  {
    id: "crash",
    label: "Crash details",
    description: "Keep crash reports that help explain why a Test stopped.",
  },
  {
    id: "audio",
    label: "Audio recordings",
    description: "Keep audio only when a Test needs to verify sound.",
  },
  {
    id: "network-body",
    label: "Request and response bodies",
    description: "Keep HTTP content that may include personal or account data.",
  },
  {
    id: "network-raw",
    label: "Raw network captures",
    description:
      "Keep PCAP files after a Run. Android emulator packet metadata is captured temporarily either way.",
  },
  {
    id: "browser-trace",
    label: "Browser diagnostics",
    description: "Keep a detailed browser trace for difficult failures.",
  },
];

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function setupChecks(value: unknown): readonly SetupCheck[] {
  const checks = recordValue(value)?.checks;
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((item) => {
    const check = recordValue(item);
    return typeof check?.id === "string" &&
      typeof check.label === "string" &&
      typeof check.status === "string" &&
      typeof check.detail === "string"
      ? [
          {
            id: check.id,
            label: check.label,
            status: check.status,
            detail: check.detail,
          },
        ]
      : [];
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && /failed to fetch|network|load failed/i.test(error.message)) {
    return "The Relay server could not be reached. Your existing settings are unchanged.";
  }
  return error instanceof Error ? error.message : "Relay could not complete this change.";
}

export function SetupRow({
  title,
  checks,
  loading,
  action,
}: {
  title: string;
  checks: readonly SetupCheck[];
  loading: boolean;
  action?: ReactNode;
}) {
  const attention = checks.find((check) => check.status !== "ready");
  const ready = checks.length > 0 && !attention;
  return (
    <div className="relay-setup-status">
      <Item className="relay-setting-row relay-setup-status-row" size="sm">
        <ItemContent className="relay-setting-row-copy">
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription>
            {loading
              ? "Checking support on this computer…"
              : (attention?.detail ??
                (ready
                  ? "Relay has the local support it needs."
                  : "Relay could not read this support check."))}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="relay-setting-row-control relay-setup-status-actions">
          <Badge
            variant={ready ? "default" : "secondary"}
            className={
              ready
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            }
          >
            {loading ? "Checking" : ready ? "Ready" : "Needs attention"}
          </Badge>
          {!loading && attention ? action : null}
        </ItemActions>
      </Item>
      {!loading && attention && checks.length > 1 ? (
        <Collapsible className="relay-setup-checks">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Diagnostic checks ({checks.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 border-t pt-3 text-sm">
            <ul>
              {checks.map((check) => (
                <li key={check.id}>
                  <Badge
                    variant={check.status === "ready" ? "default" : "secondary"}
                    className={
                      check.status === "ready"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    }
                  >
                    {check.status === "ready" ? "Ready" : "Needs attention"}
                  </Badge>
                  <div>
                    <strong>{check.label}</strong>
                    <p>{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
