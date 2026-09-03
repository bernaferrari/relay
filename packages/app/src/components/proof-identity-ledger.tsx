import { For, Show, type JSX } from "solid-js";
import {
  changeTestedSha,
  type ChangeProofPublicationReceipt,
  type ChangeVerification,
} from "@relay/protocol";
import { cn } from "../lib/cn";
import { mono } from "../lib/ui";

/** A compact, read-only ledger for the identities that make a Proof auditable.
 * Long digests stay complete here; the surrounding Proof copy may use short
 * labels, but an operator must be able to compare the exact artifacts. */
export function ProofIdentityLedger(props: {
  proof: ChangeVerification;
  publication?: ChangeProofPublicationReceipt;
}) {
  return (
    <details
      class="rounded-xl bg-surface-base px-4 ring-1 ring-inset ring-border-weak-base"
      data-proof-identity-ledger
      aria-label="Technical Proof details"
    >
      <summary class="flex min-h-11 cursor-pointer select-none items-center py-3 text-body font-medium text-text-base">
        Technical details
      </summary>
      <dl class="m-0 grid gap-3 border-t border-border-weak-base pb-4 pt-3 text-caption">
        <IdentityFact label="Change">
          <div class={cn("grid gap-1 text-text-strong", mono)}>
            <code class="break-all">{props.proof.change.repository}</code>
            <code class="break-all">
              base tip {props.proof.change.baseTipSha ?? props.proof.change.baseSha}
            </code>
            <code class="break-all">
              merge base {props.proof.change.mergeBaseSha ?? props.proof.change.baseSha}
            </code>
            <code class="break-all">
              requested {props.proof.change.requestedHeadSha ?? props.proof.change.headSha}
            </code>
          </div>
        </IdentityFact>
        <IdentityFact label="Tested head">
          <code class={cn("break-all text-text-strong", mono)}>
            {changeTestedSha(props.proof.change)}
          </code>
        </IdentityFact>
        <IdentityFact label="Builds">
          <div class="grid gap-1.5">
            <For each={props.proof.builds}>
              {(build) => (
                <code class={cn("break-all text-text-strong", mono)}>
                  {build.id} · {build.platform} · source {build.sourceSha} · artifact{" "}
                  {build.artifactDigest}
                </code>
              )}
            </For>
          </div>
        </IdentityFact>
        <IdentityFact label="Verification Cells">
          <div class="grid gap-1.5">
            <For each={props.proof.selection.cells ?? []}>
              {(cell) => (
                <div
                  class={cn(
                    "grid gap-1 border-t border-border-weak-base pt-2 first:border-t-0 first:pt-0",
                    mono,
                  )}
                >
                  <code class="break-all font-semibold text-text-strong">{cell.id}</code>
                  <code class="break-all text-text-base">
                    {cell.journey.appMapId}/{cell.journey.testId}@{cell.journey.appMapRevision} ·
                    target {cell.targetCaseId} · build {cell.buildId}
                  </code>
                  <code class="break-all text-text-weak">
                    dimensions {JSON.stringify(cell.dimensions)} · route {cell.routeVariantDigest} ·
                    evidence {cell.evidencePolicyDigest} · risk {cell.executionRiskDigest}
                  </code>
                </div>
              )}
            </For>
          </div>
        </IdentityFact>
        <IdentityFact label="Policy and plan">
          <div class={cn("grid gap-1 text-text-strong", mono)}>
            <code class="break-all">policy {props.proof.policyDigest}</code>
            <code class="break-all">plan {props.proof.planDigest}</code>
            <code class="break-all">decision {props.proof.decisionDigest ?? "Not recorded"}</code>
          </div>
        </IdentityFact>
        <IdentityFact label="TracePacks">
          <div class="grid gap-1.5">
            <For each={props.proof.evidenceDigests}>
              {(digest) => <code class={cn("break-all text-text-strong", mono)}>{digest}</code>}
            </For>
            <Show when={!props.proof.evidenceDigests.length}>
              <span class="text-text-weak">No TracePack has been recorded yet.</span>
            </Show>
          </div>
        </IdentityFact>
        <IdentityFact label="GitHub Check">
          <Show
            when={props.publication}
            fallback={
              <span class="text-text-weak">No acknowledged Check for this Proof version.</span>
            }
          >
            {(publication) => (
              <div class="grid gap-1">
                <code class={cn("break-all text-text-strong", mono)}>
                  {publication().provider} · {publication().externalId} · Check #
                  {publication().checkRunId} · {publication().status ?? "completed"}
                  {publication().conclusion ? ` · ${publication().conclusion}` : ""}
                </code>
                <code class={cn("break-all text-text-weak", mono)}>
                  head {publication().headSha} · digest {publication().checkDigest}
                </code>
              </div>
            )}
          </Show>
        </IdentityFact>
      </dl>
    </details>
  );
}

function IdentityFact(props: { label: string; children: JSX.Element }) {
  return (
    <div class="grid gap-1.5 border-t border-border-weak-base pt-2.5 first:border-t-0 first:pt-0">
      <dt class="font-medium text-text-weak">{props.label}</dt>
      <dd class="m-0 min-w-0">{props.children}</dd>
    </div>
  );
}
