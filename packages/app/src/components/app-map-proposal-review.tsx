import { For, Show, createSignal } from "solid-js";
import type { AppMap, Proposal, ProposalChange, ScreenVariant } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { Icon } from "./icon";

function describeChange(change: ProposalChange): string {
  if (change.kind === "screen.add") return `Add screen “${change.input.screen.title}”`;
  if (change.kind === "screen.update") return `Update screen ${change.screenId}`;
  if (change.kind === "screen.remove") return `Remove screen ${change.screenId}`;
  if (change.kind === "connection.connect")
    return `Add path from ${change.connection.fromScreenId}`;
  if (change.kind === "connection.update") return `Update path ${change.connectionId}`;
  if (change.kind === "connection.remove") return `Remove path ${change.connectionId}`;
  if (change.kind === "group.save") return `Save Group “${change.group.name}”`;
  return `Remove Group ${change.groupId}`;
}

function screenVariantReplacement(
  proposal: Proposal,
): { screenId: string; variant: ScreenVariant } | undefined {
  const change = proposal.changes.find(
    (candidate) => candidate.kind === "screen.update" && candidate.input.upsertVariants?.length,
  );
  if (!change || change.kind !== "screen.update") return undefined;
  const variant = change.input.upsertVariants?.[0];
  return variant ? { screenId: change.screenId, variant } : undefined;
}

function accessibilityTreePreview(variant: ScreenVariant): string {
  const nodes = variant.observation?.nodes ?? [];
  const preview = nodes.slice(0, 24).map((node) => {
    const name = node.identifier ?? node.label ?? node.value ?? "—";
    return `${node.role || "element"} · ${name}`;
  });
  if (nodes.length > preview.length) preview.push(`… ${nodes.length - preview.length} more`);
  return preview.join("\n") || "No accessibility tree was captured.";
}

export function AppMapProposalReview(props: {
  appMap: AppMap;
  proposals: readonly Proposal[];
  busyId?: string;
  error?: string;
  evidenceUrl: (uri: string) => string;
  onApprove: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  onRequestChanges: (proposalId: string, reason: string) => void;
  onClose: () => void;
}) {
  const [feedbackId, setFeedbackId] = createSignal<string>();
  const [feedback, setFeedback] = createSignal("");
  return (
    <aside
      class="absolute top-3 right-3 z-30 flex max-h-[calc(100%-80px)] w-[min(360px,calc(100%-24px))] flex-col overflow-hidden rounded-[14px] bg-[var(--background-base)] shadow-[var(--map-elevation-panel)]"
      aria-label="Suggested map changes"
      data-app-map-native-scroll
      onWheel={(event) => event.stopPropagation()}
    >
      <header class="flex min-h-12 items-center gap-2 border-b border-[var(--border-weak-base)] px-3">
        <span class="grid size-7 place-items-center rounded-[8px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
          <Icon name="sparkle" size={13} />
        </span>
        <div class="min-w-0 flex-1">
          <strong class="block text-[12px] font-semibold text-[var(--text-strong)]">
            Proposed map changes
          </strong>
          <span class="block text-[10px] text-[var(--text-weak)]">
            Nothing is added until you keep a suggestion.
          </span>
        </div>
        <button
          type="button"
          class="grid size-10 place-items-center rounded-[8px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
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
            {(proposal) => {
              const replacement = screenVariantReplacement(proposal);
              const currentVariant = replacement
                ? props.appMap.screenVariants[replacement.variant.id]
                : undefined;
              const screenReview =
                replacement && currentVariant
                  ? { currentVariant, proposedVariant: replacement.variant }
                  : undefined;
              const isScreenReview = Boolean(screenReview);
              return (
                <article class="rounded-[10px] bg-[var(--surface-base)] p-3 shadow-[inset_0_0_0_1px_var(--border-weak-base)]">
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
                  <Show when={screenReview}>
                    <div class="mt-3 rounded-[9px] bg-[var(--background-base)] p-2 shadow-[inset_0_0_0_1px_var(--border-weak-base)]">
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <span class="text-[10px] font-medium text-[var(--text-strong)]">
                          Compare evidence
                        </span>
                        <span class="text-[9px] text-[var(--text-weak)]">
                          {screenReview!.currentVariant.observation?.nodes.length ?? 0} →{" "}
                          {screenReview!.proposedVariant.observation?.nodes.length ?? 0}{" "}
                          accessibility nodes
                        </span>
                      </div>
                      <div class="grid grid-cols-2 gap-2">
                        <div class="min-w-0">
                          <span class="mb-1 block text-[9px] font-medium text-[var(--text-weak)]">
                            Current
                          </span>
                          <Show
                            when={screenReview!.currentVariant.screenshotUri}
                            fallback={
                              <div class="grid aspect-[4/3] place-items-center rounded-[6px] bg-[var(--surface-base-hover)] px-2 text-center text-[9px] text-[var(--text-weak)]">
                                No screenshot
                              </div>
                            }
                          >
                            <img
                              class="aspect-[4/3] w-full rounded-[6px] object-cover shadow-[inset_0_0_0_1px_var(--border-weak-base)]"
                              src={props.evidenceUrl(screenReview!.currentVariant.screenshotUri!)}
                              alt="Current approved screen capture"
                            />
                          </Show>
                        </div>
                        <div class="min-w-0">
                          <span class="mb-1 block text-[9px] font-medium text-[var(--text-weak)]">
                            New capture
                          </span>
                          <Show
                            when={screenReview!.proposedVariant.screenshotUri}
                            fallback={
                              <div class="grid aspect-[4/3] place-items-center rounded-[6px] bg-[var(--surface-base-hover)] px-2 text-center text-[9px] text-[var(--text-weak)]">
                                No screenshot
                              </div>
                            }
                          >
                            <img
                              class="aspect-[4/3] w-full rounded-[6px] object-cover shadow-[inset_0_0_0_1px_var(--border-focus)]"
                              src={props.evidenceUrl(screenReview!.proposedVariant.screenshotUri!)}
                              alt="New screen capture awaiting review"
                            />
                          </Show>
                        </div>
                      </div>
                      <p class="mt-2 text-[9.5px]/[1.45] text-[var(--text-weak)]">
                        Screenshots and accessibility semantics are saved together. Keeping the new
                        capture replaces this target variant; keeping current discards it.
                      </p>
                      <details class="mt-2 text-[9.5px] text-[var(--text-weak)]">
                        <summary class="cursor-pointer font-medium text-[var(--text-base)] hover:text-[var(--text-strong)]">
                          Compare accessibility trees
                        </summary>
                        <div class="mt-2 grid grid-cols-2 gap-2">
                          <pre class="max-h-28 overflow-auto whitespace-pre-wrap rounded-[6px] bg-[var(--surface-base-hover)] p-1.5 font-mono text-[8.5px]/[1.4] text-[var(--text-base)]">
                            {accessibilityTreePreview(screenReview!.currentVariant)}
                          </pre>
                          <pre class="max-h-28 overflow-auto whitespace-pre-wrap rounded-[6px] bg-[var(--surface-base-hover)] p-1.5 font-mono text-[8.5px]/[1.4] text-[var(--text-base)]">
                            {accessibilityTreePreview(screenReview!.proposedVariant)}
                          </pre>
                        </div>
                      </details>
                    </div>
                  </Show>
                  <Show when={feedbackId() === proposal.id}>
                    <div class="mt-3 grid gap-2">
                      <label class="grid gap-1 text-[10px] font-medium text-[var(--text-base)]">
                        What should the agent change?
                        <textarea
                          autofocus
                          class="min-h-20 resize-y rounded-[8px] bg-[var(--background-base)] px-2.5 py-2 text-[11px]/[1.45] text-[var(--text-strong)] outline-none shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus:shadow-[inset_0_0_0_2px_var(--border-focus)]"
                          value={feedback()}
                          onInput={(event) => setFeedback(event.currentTarget.value.slice(0, 500))}
                        />
                      </label>
                      <div class="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setFeedbackId();
                            setFeedback("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          disabled={!feedback().trim() || Boolean(props.busyId)}
                          onClick={() => props.onRequestChanges(proposal.id, feedback().trim())}
                        >
                          Send request
                        </Button>
                      </div>
                    </div>
                  </Show>
                  <Show when={feedbackId() !== proposal.id}>
                    <div class="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Button
                        variant="primary"
                        size="lg"
                        disabled={Boolean(props.busyId)}
                        onClick={() => props.onApprove(proposal.id)}
                      >
                        {props.busyId === proposal.id
                          ? "Saving…"
                          : isScreenReview
                            ? "Replace approved"
                            : "Keep suggestion"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={Boolean(props.busyId)}
                        onClick={() => {
                          setFeedbackId(proposal.id);
                          setFeedback("");
                        }}
                      >
                        Request changes
                      </Button>
                      <button
                        type="button"
                        class="min-h-10 rounded-[8px] px-2 text-[10.5px] font-medium text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--icon-critical-base)] disabled:opacity-50"
                        disabled={Boolean(props.busyId)}
                        onClick={() => props.onReject(proposal.id)}
                      >
                        {isScreenReview ? "Keep current" : "Reject"}
                      </button>
                    </div>
                  </Show>
                </article>
              );
            }}
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
