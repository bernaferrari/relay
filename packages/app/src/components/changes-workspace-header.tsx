import { Show, type Accessor } from "solid-js";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { eyebrow, productIconButton } from "../lib/ui";
import { Icon } from "./icon";

export function ChangesWorkspaceHeader(props: {
  mobileDetailOpen: Accessor<boolean>;
  canCreate: Accessor<boolean>;
  loading: Accessor<boolean>;
  inspecting: Accessor<boolean>;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  return (
    <header
      class={cn(
        "mx-auto flex w-full max-w-[1180px] items-start justify-between gap-6 max-[620px]:flex-col",
        props.mobileDetailOpen() && "max-[820px]:hidden",
      )}
    >
      <div class="grid max-w-[760px] gap-2">
        <span class={eyebrow}>Merge trust</span>
        <h1 class="m-0 text-display font-semibold tracking-[-0.035em] text-text-strong">
          Prove a change
        </h1>
        <p class="m-0 text-body/[1.5] text-text-base">
          Inspect why Relay selected each journey, which exact builds and targets ran, what evidence
          is complete, and whether this change earned permission to merge.
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2 max-[620px]:self-stretch">
        <Show when={props.canCreate()}>
          <Button variant="primary" onClick={props.onCreate}>
            Prepare a Proof
          </Button>
        </Show>
        <button
          type="button"
          class={productIconButton}
          aria-label="Refresh Proofs"
          disabled={props.loading() || props.inspecting()}
          onClick={props.onRefresh}
        >
          <Icon name="refresh" size={16} />
        </button>
      </div>
    </header>
  );
}
