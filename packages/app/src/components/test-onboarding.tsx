import { Show } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { productPrimary, productSecondary } from "../lib/ui";
import { Icon } from "./icon";

/**
 * The launch surface offers only the two useful choices: create work or find
 * existing work. Device control belongs inside a journey, where it has context.
 */
export function TestWelcome(props: { onStartJourney: () => void; onBrowse: () => void }) {
  const server = useServer();
  const journeyCount = () => server.recipes().filter((recipe) => recipe.source === "custom").length;

  return (
    <section
      class="relative isolate flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-[var(--v2-background-bg-deep)] px-6 py-10"
      aria-labelledby="session-home-title"
    >
      <div
        class="pointer-events-none absolute inset-0 opacity-40"
        style={{
          "background-image":
            "radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--text-strong) 8%,transparent) 1px,transparent 0)",
          "background-size": "22px 22px",
        }}
      />

      <div class="relative z-10 grid max-w-[560px] justify-items-center text-center">
        <span class="grid size-11 place-items-center rounded-[14px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--v2-background-bg-accent)_20%,transparent),0_10px_28px_rgb(0_0_0/18%)]">
          <Icon name="move" size={19} />
        </span>
        <h2
          id="session-home-title"
          class="m-0 mt-5 max-w-[18ch] text-[clamp(28px,4vw,46px)] leading-[1.02] font-semibold tracking-[-0.048em] text-[var(--text-strong)] text-balance"
        >
          Map what should happen on your device
        </h2>
        <p class="m-0 mt-3 max-w-[48ch] text-[13px]/[1.6] text-[var(--text-weak)] text-pretty">
          Add screens, connect them, then try each connection on a real device. Start anywhere and
          change anything later.
        </p>
        <div class="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            class={cn(productPrimary, "min-h-11 gap-2 px-4 text-[12.5px]")}
            onClick={props.onStartJourney}
          >
            <Icon name="plus" size={14} /> New journey
          </button>
          <Show when={journeyCount() > 0}>
            <button
              type="button"
              class={cn(productSecondary, "min-h-11 gap-2 px-4 text-[12.5px]")}
              onClick={props.onBrowse}
            >
              Browse journeys
            </button>
          </Show>
        </div>
      </div>
    </section>
  );
}
