import { type ComponentProps, splitProps } from "solid-js";
import "./button.css";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  selected?: boolean;
}

export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, [
    "variant",
    "size",
    "selected",
    "class",
    "classList",
    "children",
    "type",
  ]);
  return (
    <button
      {...rest}
      type={split.type ?? "button"}
      data-component="button"
      data-size={split.size || "md"}
      data-variant={split.variant || "primary"}
      data-selected={split.selected ? "true" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </button>
  );
}
