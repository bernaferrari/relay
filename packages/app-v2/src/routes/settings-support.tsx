/** @jsxImportSource react */
import {
  Badge,
  Disclosure,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@relay/ui-react";
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
      <Item className="relay-setting-row relay-setup-status-row" size="small">
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
          <Badge variant={ready ? "success" : "warning"}>
            {loading ? "Checking" : ready ? "Ready" : "Needs attention"}
          </Badge>
          {!loading && attention ? action : null}
        </ItemActions>
      </Item>
      {!loading && attention && checks.length > 1 ? (
        <Disclosure.Root className="relay-setup-checks">
          <Disclosure.Trigger>Diagnostic checks ({checks.length})</Disclosure.Trigger>
          <Disclosure.Panel>
            <ul>
              {checks.map((check) => (
                <li key={check.id}>
                  <Badge variant={check.status === "ready" ? "success" : "warning"}>
                    {check.status === "ready" ? "Ready" : "Needs attention"}
                  </Badge>
                  <div>
                    <strong>{check.label}</strong>
                    <p>{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Disclosure.Panel>
        </Disclosure.Root>
      ) : null}
    </div>
  );
}
