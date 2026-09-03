import { Show } from "solid-js";
import type { JobInfo } from "../context/server";
import { Icon } from "./icon";

export function RunDetailsDisclosure(props: { job: JobInfo }) {
  const job = () => props.job;
  const evidenceChannels = () => Object.values(job().evidence?.channels ?? {});
  const capturedEvidenceCount = () =>
    evidenceChannels().filter((channel) => channel.status === "captured").length;
  const unavailableEvidence = () =>
    evidenceChannels().filter((channel) => channel.status !== "captured");
  return (
    <details class="group col-span-2 mt-2 border-t border-border-weak-base">
      <summary class="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-caption/[1.25] text-text-weaker focus-visible:outline-1 focus-visible:outline-border-strong-focus [&::-webkit-details-marker]:hidden">
        <span>More details</span>
        <Icon name="chevron-down" size={13} class="transition-transform group-open:rotate-180" />
      </summary>
      <dl class="m-0 grid grid-cols-2 gap-3 pb-3 max-[560px]:grid-cols-1">
        <Show when={evidenceChannels().length > 0}>
          <div class="col-span-2 grid gap-1 rounded-lg bg-surface-base px-3 py-2.5 max-[560px]:col-span-1">
            <dt class="text-caption font-semibold text-text-strong">Evidence collected</dt>
            <dd class="m-0 text-caption/[1.45] text-text-weak">
              {capturedEvidenceCount()} of {evidenceChannels().length} available channels back this
              result. Channels Relay could not collect were not used as proof.
              <Show when={unavailableEvidence().length > 0}>
                <span class="mt-1 block text-micro text-text-weaker">
                  Not collected:{" "}
                  {unavailableEvidence()
                    .map((channel) => `${channel.channel} (${channel.status})`)
                    .join(", ")}
                  .
                </span>
              </Show>
            </dd>
          </div>
        </Show>
        <div class="grid min-w-0 gap-1">
          <dt class="min-w-0 text-micro/[1.25] text-text-weaker">Run ID</dt>
          <dd class="m-0 flex min-w-0 items-center gap-1.5">
            <code class="truncate text-micro/[1.25] text-text-weak">{job().id}</code>
            <button
              type="button"
              class="grid size-8 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
              aria-label="Copy run ID"
              onClick={() => void navigator.clipboard?.writeText(job().id)}
            >
              <Icon name="copy" size={12} />
            </button>
          </dd>
        </div>
        <Show when={job().serial}>
          <div class="grid min-w-0 gap-1">
            <dt class="min-w-0 text-micro/[1.25] text-text-weaker">Device identifier</dt>
            <dd class="m-0 flex min-w-0 items-center gap-1.5">
              <code class="truncate text-micro/[1.25] text-text-weak">{job().serial}</code>
              <button
                type="button"
                class="grid size-8 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
                aria-label="Copy device identifier"
                onClick={() => void navigator.clipboard?.writeText(job().serial!)}
              >
                <Icon name="copy" size={12} />
              </button>
            </dd>
          </div>
        </Show>
        <Show when={job().error}>
          <div class="grid gap-1 border-t border-border-weak-base pt-2.5">
            <dt class="min-w-0 text-micro/[1.25] text-text-weaker">Technical message</dt>
            <dd class="m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-micro/[1.45] text-text-weak">
              {job().error}
            </dd>
          </div>
        </Show>
      </dl>
    </details>
  );
}
