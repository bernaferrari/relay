import { For, type JSX } from "solid-js";

/** Compact, Base UI-inspired discrete slider built on the native range input. */
export function MaterialDiscreteSlider(props: {
  value: number;
  count: number;
  label: string;
  valueText: string;
  onInput: (value: number) => void;
}): JSX.Element {
  const max = () => Math.max(0, props.count - 1);
  const value = () => Math.max(0, Math.min(Math.round(props.value), max()));
  const percent = () => (max() === 0 ? 0 : (value() / max()) * 100);

  return (
    <div class="group relative h-9 px-2.5">
      <div class="pointer-events-none absolute top-3.5 right-2.5 left-2.5 h-1 rounded-full bg-[var(--v2-background-bg-layer-02)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_58%,transparent)]">
        <i
          class="absolute inset-y-0 left-0 rounded-full bg-[var(--v2-background-bg-accent)]"
          style={{ width: `${percent()}%` }}
        />
      </div>
      <span
        class="pointer-events-none absolute top-3.5 z-[1] size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color-mix(in_srgb,var(--v2-background-bg-accent)_72%,white)] bg-[var(--v2-background-bg-accent)] shadow-[0_1px_2px_rgb(0_0_0/34%),0_0_0_3px_var(--v2-background-bg-base)] transition-[box-shadow,transform] duration-150 ease-out group-hover:shadow-[0_1px_2px_rgb(0_0_0/34%),0_0_0_3px_var(--v2-background-bg-base),0_0_0_5px_color-mix(in_srgb,var(--v2-background-bg-accent)_16%,transparent)] group-has-[input:active]:scale-110 group-has-[input:focus-visible]:shadow-[0_1px_2px_rgb(0_0_0/34%),0_0_0_3px_var(--v2-background-bg-base),0_0_0_5px_color-mix(in_srgb,var(--v2-background-bg-accent)_30%,transparent)]"
        style={{ left: `calc(10px + (100% - 20px) * ${percent() / 100})` }}
        aria-hidden="true"
      ></span>
      <For each={Array.from({ length: props.count })}>
        {(_, index) => (
          <i
            class={
              index() === value()
                ? "pointer-events-none absolute top-[25px] size-1 -translate-x-1/2 rounded-full bg-[var(--v2-background-bg-accent)]"
                : "pointer-events-none absolute top-[25px] size-1 -translate-x-1/2 rounded-full bg-[var(--v2-border-border-strong)] opacity-60"
            }
            style={{
              left: `calc(10px + (100% - 20px) * ${max() === 0 ? 0 : index() / max()})`,
            }}
            aria-hidden="true"
          />
        )}
      </For>
      <input
        type="range"
        min="0"
        max={max()}
        step="1"
        value={value()}
        aria-label={props.label}
        aria-valuetext={props.valueText}
        class="absolute inset-0 z-[2] h-full w-full cursor-pointer opacity-0"
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
    </div>
  );
}
