import { type ComponentProps, splitProps } from "solid-js";
import "./icon-button.css";

export type IconButtonVariant = "primary" | "secondary" | "ghost";
export type IconButtonSize = "sm" | "md" | "lg" | "small" | "normal" | "large";

export interface IconButtonProps extends ComponentProps<"button"> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Pressed / selected / expanded chrome */
  selected?: boolean;
  active?: boolean;
}

function toDataSize(size: IconButtonSize | undefined): "small" | "normal" | "large" {
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

/**
 * Relay IconButton — compact visible controls with at least a 44px effective
 * pointer target. The title bar keeps its platform-specific exception.
 * Default variant is ghost for chrome/row actions (Stage product default).
 * Pass the glyph as children (Stage uses app Icon, not a shared icon set).
 */
export function IconButton(props: IconButtonProps) {
  const [split, rest] = splitProps(props, [
    "variant",
    "size",
    "selected",
    "active",
    "class",
    "classList",
    "children",
    "type",
  ]);
  return (
    <button
      {...rest}
      type={split.type ?? "button"}
      data-component="icon-button"
      data-size={toDataSize(split.size)}
      data-variant={split.variant ?? "ghost"}
      data-selected={split.selected ? "true" : undefined}
      data-active={split.active ? "true" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </button>
  );
}
