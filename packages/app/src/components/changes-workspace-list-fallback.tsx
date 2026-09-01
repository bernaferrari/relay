import { Show, type Accessor } from "solid-js";
import { Button } from "@relay/ui/button";
import { Icon } from "./icon";

export function ChangesWorkspaceListFallback(props: {
  loading: Accessor<boolean>;
  creating: Accessor<boolean>;
  settingUp: Accessor<boolean>;
  onCreate: () => void;
}) {
  return (
    <Show
      when={!props.loading()}
      fallback={
        <div
          class="mx-auto grid min-h-[280px] w-full max-w-[1180px] grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-2xl bg-surface-raised-stronger-non-alpha ring-1 ring-inset ring-border-weak-base max-[820px]:grid-cols-1"
          role="status"
          aria-label="Loading Proofs"
        >
          <div class="grid content-start gap-3 border-r border-border-weak-base p-4 max-[820px]:hidden">
            <span class="h-16 animate-pulse rounded-xl bg-surface-base motion-reduce:animate-none" />
            <span class="h-16 animate-pulse rounded-xl bg-surface-base motion-reduce:animate-none" />
            <span class="h-16 animate-pulse rounded-xl bg-surface-base motion-reduce:animate-none" />
          </div>
          <div class="grid content-start gap-4 p-8">
            <span class="h-6 w-24 animate-pulse rounded-md bg-surface-base motion-reduce:animate-none" />
            <span class="h-8 w-3/4 animate-pulse rounded-md bg-surface-base motion-reduce:animate-none" />
            <span class="h-24 animate-pulse rounded-xl bg-surface-base motion-reduce:animate-none" />
          </div>
        </div>
      }
    >
      <Show when={!props.creating() && !props.settingUp()}>
        <div class="mx-auto grid w-full max-w-[760px] justify-items-center gap-3 rounded-2xl bg-surface-raised-stronger-non-alpha px-8 py-14 text-center ring-1 ring-inset ring-border-weak-base">
          <span class="grid size-12 place-items-center rounded-2xl bg-[var(--product-accent-soft)] text-text-interactive-base">
            <Icon name="check" size={21} />
          </span>
          <h2 class="m-0 text-title font-semibold text-text-strong">No Proofs yet</h2>
          <p class="m-0 max-w-[50ch] text-body/[1.5] text-text-base">
            Relay binds the active workspace to one exact change. Unknown impact, missing builds,
            and incomplete evidence stay visible instead of becoming an invented pass.
          </p>
          <Button variant="primary" onClick={props.onCreate}>
            Prepare a Proof
          </Button>
        </div>
      </Show>
    </Show>
  );
}
