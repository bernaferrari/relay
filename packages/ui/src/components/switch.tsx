import { type ComponentProps, splitProps } from "solid-js";
import "./switch.css";

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
    "checked",
    "disabled",
    "name",
    "value",
    "onCheckedChange",
    "children",
  ]);

  return (
    <span
      {...rootProps}
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
        data-slot="switch-input"
        onChange={(event) => state.onCheckedChange?.(event.currentTarget.checked)}
      />
      <span
        data-slot="switch-thumb"
        data-checked={state.checked ? "" : undefined}
        data-unchecked={state.checked ? undefined : ""}
        aria-hidden="true"
      />
    </span>
  );
}
