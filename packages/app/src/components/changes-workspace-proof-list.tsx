import { For, type Accessor } from "solid-js";
import { changeTestedSha, type ChangeVerification } from "@relay/protocol";
import { cn } from "../lib/cn";
import type { StatusChipTone } from "./status-chip";

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

function shortSha(value: string): string {
  return value.slice(0, 12);
}

export function changeTitle(proof: ChangeVerification): string {
  return (
    proof.change.agentClaim?.summary ||
    (proof.change.pullRequest
      ? `Pull request #${proof.change.pullRequest}`
      : shortSha(changeTestedSha(proof.change)))
  );
}

export function ChangesWorkspaceProofList(props: {
  proofs: Accessor<readonly ChangeVerification[]>;
  selectedId: Accessor<string | null>;
  mobileDetailOpen: Accessor<boolean>;
  onSelect: (proofId: string) => void;
}) {
  return (
    <nav
      class={cn(
        "min-h-0 border-r border-border-weak-base p-2",
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
                "grid min-h-[68px] w-full gap-1 rounded-xl px-3 py-2.5 text-left transition-colors",
                active() ? "bg-surface-base-active" : "hover:bg-surface-raised-base-hover",
              )}
              aria-current={active() ? "page" : undefined}
              onClick={() => props.onSelect(proof.id)}
            >
              <span class="flex min-w-0 items-center justify-between gap-2">
                <strong class="truncate text-body font-semibold text-text-strong">
                  {changeTitle(proof)}
                </strong>
                <span
                  class={cn(
                    "size-2 shrink-0 rounded-full",
                    status.tone === "pass"
                      ? "bg-icon-success-base"
                      : status.tone === "fail"
                        ? "bg-icon-critical-base"
                        : status.tone === "run"
                          ? "bg-text-interactive-base"
                          : "bg-icon-warning-base",
                  )}
                  aria-hidden="true"
                />
              </span>
              <small class="truncate text-caption text-text-weak">
                {proof.change.repository.split("/").at(-1) ?? proof.change.repository}
                {proof.change.pullRequest ? ` · #${proof.change.pullRequest}` : ""}
              </small>
              <small class="text-micro font-medium text-text-weaker">{status.label}</small>
            </button>
          );
        }}
      </For>
    </nav>
  );
}
