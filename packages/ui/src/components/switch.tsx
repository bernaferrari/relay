import { type ComponentProps, splitProps } from "solid-js";

export interface SwitchProps extends Omit<ComponentProps<"span">, "onChange"> {
  checked: boolean;
  disabled?: boolean;
  name?: string;
  value?: string;
  onCheckedChange?: (checked: boolean) => void;
}

/** Base UI-style switch anatomy: Root + native input + Thumb. */
export function Switch(props: SwitchProps) {
  const [state, rootProps] = splitProps(props, [
    "class",
    "checked",
    "disabled",
    "name",
    "value",
    "onCheckedChange",
    "children",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
  ]);

  return (
    <span
      {...rootProps}
      class={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-[var(--surface-base-active)] p-0.5 shadow-inner transition-colors duration-150 data-checked:bg-[var(--button-primary-base)] data-disabled:cursor-not-allowed data-disabled:opacity-45 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--border-strong-focus)] motion-reduce:transition-none ${state.class ?? ""}`}
      data-component="switch"
      data-checked={state.checked ? "" : undefined}
      data-unchecked={state.checked ? undefined : ""}
      data-disabled={state.disabled ? "" : undefined}
    >
      <input
        type="checkbox"
        role="switch"
        checked={state.checked}
        disabled={state.disabled}
        name={state.name}
        value={state.value}
        aria-label={state["aria-label"]}
        aria-labelledby={state["aria-labelledby"]}
        aria-describedby={state["aria-describedby"]}
        class="absolute top-1/2 left-1/2 z-1 m-0 size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer touch-manipulation opacity-0 disabled:cursor-not-allowed"
        data-slot="switch-input"
        onChange={(event) => state.onCheckedChange?.(event.currentTarget.checked)}
      />
      <span
        class="pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform duration-150 data-checked:translate-x-4 motion-reduce:transition-none"
        data-slot="switch-thumb"
        data-checked={state.checked ? "" : undefined}
        data-unchecked={state.checked ? undefined : ""}
        aria-hidden="true"
      />
    </span>
  );
}
