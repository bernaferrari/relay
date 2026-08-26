import { Show } from "solid-js";
import type { JobInfo } from "../context/server";
import { Icon } from "./icon";

export function RunDetailsDisclosure(props: { job: JobInfo }) {
  const job = () => props.job;
  return (
    <details class="group col-span-2 mt-2 border-t border-border-weak-base">
      <summary class="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-caption/[1.25] text-text-weaker focus-visible:outline-1 focus-visible:outline-border-strong-focus [&::-webkit-details-marker]:hidden">
        <span>More details</span>
        <Icon
          name="chevron-down"
          size={13}
          class="transition-transform group-open:rotate-180"
        />
      </summary>
      <dl class="m-0 grid gap-2 pb-3">
        <div class="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2.5">
          <dt class="min-w-0 text-micro/[1.25] text-text-weaker">Run ID</dt>
          <dd class="m-0 flex min-w-0 items-center gap-1.5">
            <code class="truncate text-micro/[1.25] text-text-weak">{job().id}</code>
            <button
              type="button"
              class="grid size-10 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
              aria-label="Copy run ID"
              onClick={() => void navigator.clipboard?.writeText(job().id)}
            >
              <Icon name="copy" size={12} />
            </button>
          </dd>
        </div>
        <Show when={job().serial}>
          <div class="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2.5">
            <dt class="min-w-0 text-micro/[1.25] text-text-weaker">
              Device identifier
            </dt>
            <dd class="m-0 flex min-w-0 items-center gap-1.5">
              <code class="truncate text-micro/[1.25] text-text-weak">
                {job().serial}
              </code>
              <button
                type="button"
                class="grid size-10 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
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
            <dt class="min-w-0 text-micro/[1.25] text-text-weaker">
              Technical message
            </dt>
            <dd class="m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-micro/[1.45] text-text-weak">
              {job().error}
            </dd>
          </div>
        </Show>
      </dl>
    </details>
  );
}
