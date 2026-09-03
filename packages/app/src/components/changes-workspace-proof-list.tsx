import { For, type Accessor } from "solid-js";
import type { ChangeVerification } from "@relay/protocol";
import { cn } from "../lib/cn";
import { proofDisplayTitle } from "../lib/proof-presentation";
import type { StatusChipTone } from "./status-chip";
import { ScrollArea } from "./scroll-area";

export const proofStatePresentation: Record<
  ChangeVerification["state"],
  { label: string; tone: StatusChipTone }
> = {
  planning: { label: "Planning", tone: "idle" },
  "awaiting-build": { label: "Awaiting build", tone: "attention" },
  ready: { label: "Ready", tone: "idle" },
  "running-pilot": { label: "Running pilot", tone: "run" },
  "awaiting-expansion": { label: "Pilot passed", tone: "run" },
  running: { label: "Running coverage", tone: "run" },
  proved: { label: "Proved", tone: "pass" },
  rejected: { label: "Rejected", tone: "fail" },
  "needs-review": { label: "Needs review", tone: "attention" },
  "insufficient-evidence": { label: "Insufficient evidence", tone: "attention" },
  cancelled: { label: "Cancelled", tone: "idle" },
  superseded: { label: "Superseded", tone: "idle" },
};

export function ChangesWorkspaceProofList(props: {
  proofs: Accessor<readonly ChangeVerification[]>;
  selectedId: Accessor<string | null>;
  mobileDetailOpen: Accessor<boolean>;
  onSelect: (proofId: string) => void;
}) {
  return (
    <ScrollArea
      as="nav"
      class={cn(
        "border-r border-border-weak-base p-2",
        props.mobileDetailOpen()
          ? "max-[820px]:hidden"
          : "max-[820px]:max-h-none max-[820px]:overflow-visible max-[820px]:border-r-0",
      )}
      aria-label="Proofs"
    >
      <For each={props.proofs()}>
        {(proof) => {
          const status = proofStatePresentation[proof.state];
          const active = () => props.selectedId() === proof.id;
          return (
            <button
              type="button"
              class={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-focus",
                active() ? "bg-surface-base-active" : "hover:bg-surface-raised-base-hover",
              )}
              data-proof-list-row
              data-proof-state={proof.state}
              aria-label={`${proofDisplayTitle(proof)}, ${status.label}`}
              aria-current={active() ? "page" : undefined}
              onClick={() => props.onSelect(proof.id)}
            >
              <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
                <strong class="min-w-0 truncate text-body font-semibold text-text-strong">
                  {proofDisplayTitle(proof)}
                </strong>
              </span>
              <span class="flex shrink-0 items-center gap-1.5 text-caption font-medium text-text-weak">
                <span
                  class={cn(
                    "size-2 shrink-0 rounded-full",
                    status.tone === "pass"
                      ? "bg-icon-success-base"
                      : status.tone === "fail"
                        ? "bg-icon-critical-base"
                        : status.tone === "run"
                          ? "bg-text-interactive-base"
                          : status.tone === "attention"
                            ? "bg-icon-warning-base"
                            : "bg-icon-base",
                  )}
                  data-proof-status-tone={status.tone}
                  aria-hidden="true"
                />
                {status.label}
              </span>
            </button>
          );
        }}
      </For>
    </ScrollArea>
  );
}
