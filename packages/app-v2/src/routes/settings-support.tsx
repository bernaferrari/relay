/** @jsxImportSource react */
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { ChevronRight } from "lucide-react";
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
    label: "Crashes",
    description: "Keep crash reports.",
  },
  {
    id: "audio",
    label: "Audio",
    description: "Keep audio when a Test checks sound.",
  },
  {
    id: "network-body",
    label: "HTTP bodies",
    description: "Keep request and response bodies.",
  },
  {
    id: "network-raw",
    label: "Packet captures",
    description: "Keep PCAP files after a Run.",
  },
  {
    id: "browser-trace",
    label: "Browser traces",
    description: "Keep a detailed browser trace.",
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

function statusClass(kind: "ready" | "attention" | "checking"): string {
  if (kind === "ready") return "text-emerald-800 dark:text-emerald-300";
  if (kind === "attention") return "text-amber-800 dark:text-amber-300";
  return "text-muted-foreground";
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
  const status = loading ? "Checking" : ready ? "Ready" : "Needs attention";
  const detail = loading
    ? "Checking support on this computer…"
    : attention
      ? attention.detail
      : undefined;
  const showChecks = !loading && Boolean(attention) && checks.length > 1;

  return (
    <div className="border-b border-border py-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-8 gap-y-0.5">
        <h3 className="text-[13px] font-medium leading-5 text-foreground">{title}</h3>
        <span
          className={`pt-px text-right text-[12px] leading-5 ${statusClass(
            loading ? "checking" : ready ? "ready" : "attention",
          )}`}
        >
          {status}
        </span>
        {detail ? (
          <p className="max-w-[44ch] text-[13px] leading-5 text-muted-foreground">{detail}</p>
        ) : (
          <span />
        )}
        {!loading && attention ? (
          <div className="justify-self-end text-right [&_button]:h-auto [&_button]:px-0 [&_button]:text-[12px] [&_button]:text-foreground [&_button]:underline [&_button]:underline-offset-4 [&_button]:hover:bg-transparent">
            {action}
          </div>
        ) : null}
      </div>
      {showChecks ? (
        <Collapsible className="group/setup mt-2">
          <CollapsibleTrigger className="flex items-center gap-1 text-[12px] leading-4 text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight
              className="size-3 transition-transform group-data-open/setup:rotate-90"
              aria-hidden="true"
            />
            Diagnostic checks ({checks.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 border-l border-border pl-3">
            <ul className="grid list-none gap-1.5 p-0">
              {checks.map((check) => {
                const checkReady = check.status === "ready";
                return (
                  <li
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-8"
                    key={check.id}
                  >
                    <span className="text-[12px] leading-5 text-muted-foreground">
                      {check.label}
                    </span>
                    <span
                      className={`text-[12px] leading-5 ${statusClass(
                        checkReady ? "ready" : "attention",
                      )}`}
                    >
                      {checkReady ? "Ready" : "Needs attention"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
