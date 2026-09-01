import { For, Show, type JSX } from "solid-js";
import { Button } from "@relay/ui/button";
import { VERIFY_CHANGE_POLICY, type WorkspaceChangeContext } from "@relay/protocol";
import { cn } from "../lib/cn";
import { eyebrow, mono, productIconButton } from "../lib/ui";
import { Icon } from "./icon";
import type { ProofDraft, ProofDraftErrors, ProofDraftField } from "./changes-proof-draft";

const proofInput =
  "min-h-11 w-full rounded-lg border border-border-weak-base bg-surface-base px-3 py-2 text-title/[1.4] text-text-strong outline-none transition-[border-color,box-shadow] placeholder:text-text-weaker focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-strong-focus disabled:cursor-not-allowed disabled:text-text-weaker aria-[invalid=true]:border-border-critical-base";

export function ChangesProofCreateForm(props: {
  workspaceChange: WorkspaceChangeContext | null;
  resolvingWorkspace: boolean;
  submitting: boolean;
  draft: ProofDraft;
  draftErrors: ProofDraftErrors;
  createError: string | null;
  onResolveWorkspace: (baseRef?: string) => void;
  onDraftInput: (field: ProofDraftField, value: string) => void;
  onDraftBlur: (field: ProofDraftField) => void;
  onClose: () => void;
  onSetup: () => void;
  onSubmit: (event: SubmitEvent) => void;
}) {
  return (
    <form
      class="mx-auto grid w-full max-w-[760px] gap-5 rounded-2xl bg-surface-raised-stronger-non-alpha p-[clamp(1rem,3vw,1.75rem)] ring-1 ring-inset ring-border-weak-base"
      aria-label="Prepare a Proof"
      onSubmit={props.onSubmit}
    >
      <div class="grid gap-1">
        <h2 class="m-0 text-title font-semibold text-text-strong">Review the current change</h2>
        <p class="m-0 text-body/[1.5] text-text-base">
          Relay prepares the exact builds, affected journeys, targets, and Verification Cells from
          reviewed repository policy. Missing authority stays visible and can never clear a merge.
        </p>
      </div>

      <div class="grid gap-4 rounded-xl bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
        <div class="flex min-w-0 items-start justify-between gap-4 max-[620px]:flex-col">
          <div class="grid min-w-0 gap-1">
            <span class={eyebrow}>Active workspace</span>
            <Show
              when={!props.resolvingWorkspace && props.workspaceChange}
              fallback={
                <strong class="text-body font-semibold text-text-strong" aria-live="polite">
                  Inspecting the current change…
                </strong>
              }
            >
              {(change) => (
                <>
                  <strong class="truncate text-title font-semibold text-text-strong">
                    {change().workspace.name}
                  </strong>
                  <span class="text-body text-text-base">
                    {change().head?.label ?? "Current revision unavailable"}
                  </span>
                  <span class="text-caption text-text-weak">
                    {change().branch ? `${change().branch} · ` : ""}
                    {change().changedFileCount} changed{" "}
                    {change().changedFileCount === 1 ? "file" : "files"}
                  </span>
                </>
              )}
            </Show>
          </div>
          <button
            type="button"
            class={cn(productIconButton, "shrink-0")}
            aria-label="Inspect the active workspace again"
            disabled={props.resolvingWorkspace || props.submitting}
            onClick={() => props.onResolveWorkspace()}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        <Show when={props.workspaceChange?.status === "needs-selection"}>
          <label class="grid gap-1.5 text-caption font-medium text-text-strong" for="proof-base">
            <span>Compare this change with</span>
            <select
              id="proof-base"
              class={proofInput}
              disabled={props.resolvingWorkspace || props.submitting}
              value=""
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value) props.onResolveWorkspace(value);
              }}
            >
              <option value="">Choose a reviewed branch…</option>
              <For each={props.workspaceChange?.baseCandidates ?? []}>
                {(candidate) => <option value={candidate.ref}>{candidate.label}</option>}
              </For>
            </select>
          </label>
        </Show>

        <Show when={props.workspaceChange?.blockers.length}>
          <ul class="m-0 grid gap-1 pl-5 text-caption/[1.45] text-text-critical-base" role="alert">
            <For each={props.workspaceChange?.blockers ?? []}>
              {(blocker) => <li>{blocker}</li>}
            </For>
          </ul>
        </Show>

        <p class="m-0 text-caption/[1.45] text-text-weak">
          Relay reads this from the active workspace. Restored tabs and previous-session views never
          choose the change.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
        <ProofField
          label="Pull request (optional)"
          field="pullRequest"
          error={props.draftErrors.pullRequest}
        >
          <input
            id="proof-pullRequest"
            class={proofInput}
            type="number"
            inputmode="numeric"
            value={props.draft.pullRequest}
            min="1"
            step="1"
            disabled={props.submitting}
            autocomplete="off"
            data-1p-ignore
            aria-invalid={Boolean(props.draftErrors.pullRequest)}
            aria-describedby={props.draftErrors.pullRequest ? "proof-pullRequest-error" : undefined}
            placeholder="184"
            onInput={(event) => props.onDraftInput("pullRequest", event.currentTarget.value)}
            onBlur={() => props.onDraftBlur("pullRequest")}
          />
        </ProofField>
      </div>

      <ProofField
        label="Agent completion claim (optional)"
        field="summary"
        error={props.draftErrors.summary}
      >
        <textarea
          id="proof-summary"
          class={cn(proofInput, "min-h-24 resize-y")}
          value={props.draft.summary}
          maxLength={4096}
          rows={3}
          disabled={props.submitting}
          spellcheck
          autocomplete="off"
          aria-invalid={Boolean(props.draftErrors.summary)}
          aria-describedby={props.draftErrors.summary ? "proof-summary-error" : undefined}
          placeholder="What did the coding agent say it finished?"
          onInput={(event) => props.onDraftInput("summary", event.currentTarget.value)}
          onBlur={() => props.onDraftBlur("summary")}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </ProofField>

      <ProofField
        label="Acceptance criteria (optional, one per line)"
        field="acceptanceCriteria"
        error={props.draftErrors.acceptanceCriteria}
      >
        <textarea
          id="proof-acceptanceCriteria"
          class={cn(proofInput, "min-h-24 resize-y")}
          value={props.draft.acceptanceCriteria}
          maxLength={16384}
          rows={3}
          disabled={props.submitting}
          spellcheck
          autocomplete="off"
          aria-invalid={Boolean(props.draftErrors.acceptanceCriteria)}
          aria-describedby={
            props.draftErrors.acceptanceCriteria ? "proof-acceptanceCriteria-error" : undefined
          }
          placeholder={"Settings render in Arabic\nCompact layouts have no overlap"}
          onInput={(event) => props.onDraftInput("acceptanceCriteria", event.currentTarget.value)}
          onBlur={() => props.onDraftBlur("acceptanceCriteria")}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </ProofField>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border-weak-base pt-4">
        <span class="text-caption text-text-weak">
          Policy:{" "}
          <span class={mono}>
            {VERIFY_CHANGE_POLICY.id}@{VERIFY_CHANGE_POLICY.version}
          </span>
        </span>
        <div class="flex gap-2">
          <Button
            variant="secondary"
            type="button"
            disabled={props.submitting}
            onClick={props.onSetup}
          >
            Set up policy
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={props.submitting}
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            class="min-w-28"
            variant="primary"
            type="submit"
            disabled={
              props.submitting || props.resolvingWorkspace || !props.workspaceChange?.readyForProof
            }
          >
            {props.submitting ? "Preparing…" : "Prepare Proof"}
          </Button>
        </div>
      </div>
      <Show when={props.createError}>
        {(message) => (
          <p class="m-0 text-body text-text-critical-base" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </form>
  );
}

function ProofField(props: {
  label: string;
  field: ProofDraftField;
  error?: string;
  children: JSX.Element;
}) {
  return (
    <label
      for={`proof-${props.field}`}
      class="grid content-start gap-1.5 text-caption font-medium text-text-strong"
    >
      <span>{props.label}</span>
      {props.children}
      <Show when={props.error}>
        {(message) => (
          <span
            id={`proof-${props.field}-error`}
            class="text-caption/[1.4] text-text-critical-base"
            role="alert"
          >
            {message()}
          </span>
        )}
      </Show>
    </label>
  );
}
