import { type ComponentProps, splitProps } from "solid-js";
import "./button.css";

/** Matches packages/ui button.css data-size values (AgentBoard). */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "small" | "normal" | "large";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  selected?: boolean;
}

function toDataSize(size: ButtonSize | undefined): "small" | "normal" | "large" {
  switch (size) {
    case "sm":
    case "small":
      return "small";
    case "lg":
    case "large":
      return "large";
    case "md":
    case "normal":
    default:
      return "normal";
  }
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
      data-size={toDataSize(split.size)}
      data-variant={split.variant || "secondary"}
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
