import { type ComponentProps, splitProps } from "solid-js";

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

const variantClasses = {
  primary:
    "border-transparent bg-[var(--button-primary-base)] text-[var(--button-primary-foreground)] shadow-sm enabled:hover:bg-[var(--button-primary-hover)] enabled:active:bg-[var(--button-primary-active)] enabled:active:scale-[0.98]",
  secondary:
    "border-[var(--border-weak-base)] bg-[var(--button-secondary-base)] text-[var(--text-strong)] shadow-xs enabled:hover:bg-[var(--button-secondary-hover)] enabled:active:scale-[0.98]",
  ghost:
    "border-transparent bg-transparent text-[var(--text-strong)] enabled:hover:bg-[var(--surface-base-hover)] enabled:active:bg-[var(--surface-base-active)] data-[selected=true]:bg-[var(--surface-base-hover)] aria-expanded:bg-[var(--surface-base-active)] aria-[current=page]:bg-[var(--surface-base-active)]",
  danger:
    "border-[color-mix(in_srgb,var(--icon-critical-base)_30%,transparent)] bg-[var(--surface-critical-weak)] text-[var(--text-critical-base)] enabled:hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)]",
};
const sizeClasses = {
  small: "size-8 before:-inset-1.5",
  normal: "size-9 before:-inset-1",
  large: "size-11 before:inset-0",
};

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
      class={`relative inline-flex items-center justify-center whitespace-nowrap select-none border rounded-[var(--radius-md)] font-sans font-medium text-xs outline-none transition-[background-color,border-color,box-shadow,color,transform] duration-150 motion-reduce:transition-none motion-reduce:active:transform-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background-base)] disabled:cursor-not-allowed disabled:opacity-50 [&>*]:text-inherit shrink-0 aspect-square p-0 before:absolute before:content-[''] data-[active=true]:bg-[var(--surface-base-active)] [&.titlebar-icon]:h-6 [&.titlebar-icon]:w-8 ${variantClasses[split.variant ?? "ghost"]} ${sizeClasses[toDataSize(split.size)]} ${split.class ?? ""}`}
      classList={split.classList}
    >
      {split.children}
    </button>
  );
}
