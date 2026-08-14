import { For, Show } from "solid-js";
import type {
  AppMapScenarioTest,
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  Proposal,
} from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { findScenarioStep } from "../lib/app-map-test-editor-tree";
import { Icon } from "./icon";

function bindingSummary(step: AppMapScenarioTestStep, binding = step.binding): string {
  if (binding.status === "unresolved") return `Unresolved — ${binding.reason}`;
  if (binding.kind === "connections")
    return `${binding.connectionIds.length} mapped path${binding.connectionIds.length === 1 ? "" : "s"}`;
  if (binding.kind === "assertion") return `Validation · ${binding.assertion.kind}`;
  if (binding.kind === "extract") return `Extract as {{${binding.as}}}`;
  if (binding.kind === "pause") return `Human checkpoint · ${binding.message}`;
  if (binding.kind === "routine") return `Module · ${binding.routineId}`;
  if (binding.kind === "condition")
    return `${binding.input} ${binding.operator} ${binding.expected ?? ""}`.trim();
  if (binding.kind === "repeat") return `Repeat ${binding.count}×`;
  if (binding.kind === "script") return "Constrained script";
  return step.kind;
}

function editDetails(test: AppMapScenarioTest, edit: AppMapScenarioTestEdit) {
  if (edit.kind === "test.patch") {
    return {
      title: "Test settings",
      before: test.name,
      after: edit.patch.name ?? test.name,
    };
  }
  if (edit.kind === "step.add") {
    return { title: `Add ${edit.step.kind}`, before: "Not present", after: edit.step.intent };
  }
  const current = "stepId" in edit ? findScenarioStep(test.steps, edit.stepId) : undefined;
  if (edit.kind === "step.remove") {
    return {
      title: `Remove ${current?.kind ?? "step"}`,
      before: current?.intent ?? edit.stepId,
      after: "Removed",
    };
  }
  if (edit.kind === "step.reorder") {
    const labels = edit.orderedStepIds.map((id) => findScenarioStep(test.steps, id)?.intent ?? id);
    return { title: "Reorder steps", before: "Current order", after: labels.join(" → ") };
  }
  if (edit.kind === "step.unbind") {
    return {
      title: current?.intent ?? "Step binding",
      before: current ? bindingSummary(current) : "Current binding",
      after: `Unresolved — ${edit.reason}`,
    };
  }
  if (edit.kind === "step.bind") {
    return {
      title: current?.intent ?? "Step binding",
      before: current ? bindingSummary(current) : "Current binding",
      after: current ? bindingSummary(current, edit.binding) : "New binding",
    };
  }
  const changed =
    edit.patch.intent !== undefined
      ? "intent"
      : edit.patch.binding !== undefined
        ? "binding"
        : "note";
  return {
    title: `${current?.kind ?? "Step"} ${changed}`,
    before:
      changed === "intent"
        ? (current?.intent ?? "")
        : changed === "binding" && current
          ? bindingSummary(current)
          : (current?.note ?? "No note"),
    after:
      changed === "intent"
        ? (edit.patch.intent ?? "")
        : changed === "binding" && current && edit.patch.binding
          ? bindingSummary(current, edit.patch.binding)
          : (edit.patch.note ?? "No note"),
  };
}

export function AppMapTestProposalReview(props: {
  test: AppMapScenarioTest;
  proposals: readonly Proposal[];
  busyId?: string;
  error?: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside
      class="absolute inset-y-3 right-3 z-50 flex w-[min(440px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-border-strong-base bg-background-base shadow-[var(--shadow-lg)] max-[760px]:inset-2 max-[760px]:w-auto"
      aria-label="Proposed Test changes"
    >
      <header class="flex min-h-14 items-center gap-3 border-b border-border-weak-base px-3">
        <span class="grid size-9 place-items-center rounded-lg bg-[var(--product-accent-soft)] text-text-interactive-base">
          <Icon name="sparkle" size={15} />
        </span>
        <div class="min-w-0 flex-1">
          <strong class="block text-[13px]">Review Test changes</strong>
          <span class="block text-[11px] text-text-weak">
            Nothing changes until you approve it.
          </span>
        </div>
        <button
          type="button"
          class="grid min-h-11 min-w-11 place-items-center rounded-lg text-text-weak hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-border-strong-focus"
          aria-label="Close Test proposal review"
          onClick={props.onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </header>
      <div class="grid min-h-0 gap-3 overflow-y-auto p-3">
        <For each={props.proposals}>
          {(proposal) => (
            <article class="rounded-xl border border-border-weak-base bg-surface-base p-3">
              <strong class="block text-[13px] text-text-strong">{proposal.title}</strong>
              <Show when={proposal.description}>
                <p class="mt-1 text-[11px]/[1.5] text-text-weak">{proposal.description}</p>
              </Show>
              <div class="mt-3 grid gap-2">
                <For
                  each={
                    proposal.changes.filter((change) => change.kind === "test.edit") as Array<
                      Extract<Proposal["changes"][number], { kind: "test.edit" }>
                    >
                  }
                >
                  {(change) => (
                    <For each={change.edits}>
                      {(edit) => {
                        const details = editDetails(props.test, edit);
                        return (
                          <section class="rounded-lg bg-background-base p-2.5 shadow-[inset_0_0_0_1px_var(--border-weak-base)]">
                            <strong class="block text-[11px] text-text-strong">
                              {details.title}
                            </strong>
                            <div class="mt-2 grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-start gap-2 text-[11px]/[1.45]">
                              <span class="min-w-0 break-words text-text-weak">
                                {details.before}
                              </span>
                              <Icon name="arrow-right" size={11} class="mt-0.5 text-text-weaker" />
                              <span class="min-w-0 break-words font-medium text-text-strong">
                                {details.after}
                              </span>
                            </div>
                          </section>
                        );
                      }}
                    </For>
                  )}
                </For>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  size="lg"
                  disabled={Boolean(props.busyId)}
                  onClick={() => props.onApprove(proposal.id)}
                >
                  {props.busyId === proposal.id ? "Applying…" : "Approve changes"}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={Boolean(props.busyId)}
                  onClick={() => props.onReject(proposal.id)}
                >
                  Reject
                </Button>
              </div>
            </article>
          )}
        </For>
        <Show when={props.error}>
          <p
            class="m-0 rounded-lg bg-surface-critical-weak p-3 text-[12px] text-text-critical-base"
            role="alert"
          >
            {props.error}
          </p>
        </Show>
      </div>
    </aside>
  );
}
