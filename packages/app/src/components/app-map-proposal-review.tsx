import { For, Show } from "solid-js";
import type { Proposal, ProposalChange } from "@relay/protocol";
import { Icon } from "./icon";

function describeChange(change: ProposalChange): string {
  if (change.kind === "screen.add") return `Add screen “${change.input.screen.title}”`;
  if (change.kind === "screen.update") return `Update screen ${change.screenId}`;
  if (change.kind === "screen.remove") return `Remove screen ${change.screenId}`;
  if (change.kind === "connection.connect") return `Connect from ${change.connection.fromScreenId}`;
  if (change.kind === "connection.update") return `Update connection ${change.connectionId}`;
  return `Remove connection ${change.connectionId}`;
}

export function AppMapProposalReview(props: {
  proposals: readonly Proposal[];
  busyId?: string;
  error?: string;
  onApprove: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside
      class="absolute top-4 right-4 z-30 flex max-h-[calc(100%-88px)] w-[min(360px,calc(100%-32px))] flex-col overflow-hidden rounded-[14px] bg-[var(--v2-background-bg-base)] shadow-[0_0_0_1px_var(--v2-border-border-strong),0_22px_64px_rgb(0_0_0/24%)]"
      aria-label="Agent proposals"
    >
      <header class="flex min-h-12 items-center gap-2 border-b border-[var(--v2-border-border-muted)] px-3">
        <span class="grid size-7 place-items-center rounded-[8px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
          <Icon name="sparkle" size={13} />
        </span>
        <div class="min-w-0 flex-1">
          <strong class="block text-[12px] font-semibold text-[var(--text-strong)]">
            Proposed map changes
          </strong>
          <span class="block text-[10px] text-[var(--text-weak)]">
            Nothing changes until you approve it.
          </span>
        </div>
        <button
          type="button"
          class="grid size-10 place-items-center rounded-[8px] text-[var(--text-weak)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
          aria-label="Close proposal review"
          onClick={props.onClose}
        >
          <Icon name="x" size={13} />
        </button>
      </header>
      <div class="grid min-h-0 gap-2 overflow-y-auto p-2.5">
        <Show
          when={props.proposals.length}
          fallback={
            <div class="grid min-h-36 place-items-center px-6 text-center">
              <div>
                <strong class="text-[12px] text-[var(--text-strong)]">You’re all caught up</strong>
                <p class="mt-1 text-[10.5px]/[1.5] text-[var(--text-weak)]">
                  New agent work will appear here while it is still safe to review.
                </p>
              </div>
            </div>
          }
        >
          <For each={props.proposals}>
            {(proposal) => (
              <article class="rounded-[10px] bg-[var(--v2-background-bg-layer-01)] p-3 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <strong class="block truncate text-[11.5px] font-semibold text-[var(--text-strong)]">
                      {proposal.title}
                    </strong>
                    <Show when={proposal.description}>
                      <p class="mt-1 text-[10px]/[1.45] text-[var(--text-weak)]">
                        {proposal.description}
                      </p>
                    </Show>
                  </div>
                  <span class="rounded-full bg-[var(--product-accent-soft)] px-2 py-1 text-[9px] font-medium text-[var(--text-interactive-base)]">
                    Agent
                  </span>
                </div>
                <ul class="mt-2.5 grid gap-1 text-[10px] text-[var(--text-base)]">
                  <For each={proposal.changes.slice(0, 5)}>
                    {(change) => (
                      <li class="flex items-start gap-1.5">
                        <Icon
                          name="arrow-right"
                          size={9}
                          class="mt-0.5 shrink-0 text-[var(--text-weak)]"
                        />
                        <span>{describeChange(change)}</span>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={proposal.changes.length > 5}>
                  <span class="mt-1 block text-[9.5px] text-[var(--text-weak)]">
                    +{proposal.changes.length - 5} more changes
                  </span>
                </Show>
                <div class="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    class="min-h-10 rounded-[8px] bg-[var(--product-accent)] px-3 text-[10.5px] font-semibold text-[var(--text-on-brand-base)] disabled:opacity-50"
                    disabled={Boolean(props.busyId)}
                    onClick={() => props.onApprove(proposal.id)}
                  >
                    {props.busyId === proposal.id ? "Applying…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    class="min-h-10 rounded-[8px] bg-[var(--v2-background-bg-layer-02)] px-3 text-[10.5px] font-medium text-[var(--text-base)] hover:text-[var(--text-strong)] disabled:opacity-50"
                    disabled={Boolean(props.busyId)}
                    onClick={() => props.onReject(proposal.id)}
                  >
                    Reject
                  </button>
                </div>
              </article>
            )}
          </For>
        </Show>
        <Show when={props.error}>
          <p
            role="alert"
            class="rounded-[8px] bg-[color-mix(in_srgb,var(--icon-critical-base)_10%,transparent)] p-2 text-[10px] text-[var(--icon-critical-base)]"
          >
            {props.error}
          </p>
        </Show>
      </div>
    </aside>
  );
}
