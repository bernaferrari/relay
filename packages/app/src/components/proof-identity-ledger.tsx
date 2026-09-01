import { For, Show, type JSX } from "solid-js";
import {
  changeTestedSha,
  type ChangeProofPublicationReceipt,
  type ChangeVerification,
} from "@relay/protocol";
import { cn } from "../lib/cn";
import { eyebrow, mono } from "../lib/ui";

/** A compact, read-only ledger for the identities that make a Proof auditable.
 * Long digests stay complete here; the surrounding Proof copy may use short
 * labels, but an operator must be able to compare the exact artifacts. */
export function ProofIdentityLedger(props: {
  proof: ChangeVerification;
  publication?: ChangeProofPublicationReceipt;
}) {
  return (
    <section
      class="grid gap-3 rounded-xl bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base"
      data-proof-identity-ledger
      aria-label="Exact Proof identities"
    >
      <span class={eyebrow}>Exact identities</span>
      <dl class="m-0 grid gap-3 text-caption">
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
                <code class={cn("break-all text-text-strong", mono)}>
                  {cell.id} · {cell.journey.appMapId}/{cell.journey.testId}@
                  {cell.journey.appMapRevision} · target {cell.targetCaseId} · build {cell.buildId}
                </code>
              )}
            </For>
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
    </section>
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
