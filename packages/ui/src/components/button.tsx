import { type ComponentProps, splitProps } from "solid-js";

/** Public size aliases share the same Tailwind control geometry. */
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


const variantClasses = {
  "primary": "border-transparent bg-[var(--button-primary-base)] text-[var(--button-primary-foreground)] shadow-sm enabled:hover:bg-[var(--button-primary-hover)] enabled:active:bg-[var(--button-primary-active)] enabled:active:scale-[0.98]",
  "secondary": "border-[var(--border-weak-base)] bg-[var(--button-secondary-base)] text-[var(--text-strong)] shadow-xs enabled:hover:bg-[var(--button-secondary-hover)] enabled:active:scale-[0.98]",
  "ghost": "border-transparent bg-transparent text-[var(--text-strong)] enabled:hover:bg-[var(--surface-base-hover)] enabled:active:bg-[var(--surface-base-active)] data-[selected=true]:bg-[var(--surface-base-hover)] aria-expanded:bg-[var(--surface-base-active)] aria-current-page:bg-[var(--surface-base-active)]",
  "danger": "border-[color-mix(in_srgb,var(--icon-critical-base)_30%,transparent)] bg-[var(--surface-critical-weak)] text-[var(--text-critical-base)] enabled:hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)]"
};
const sizeClasses = {
  "small": "min-h-7 gap-2 px-[9px] before:absolute before:-inset-x-1 before:-inset-y-2 before:content-['']",
  "normal": "min-h-9 gap-2 px-3 before:absolute before:-inset-1 before:content-['']",
  "large": "min-h-11 gap-2 px-4 text-sm"
};

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
      class={`relative inline-flex items-center justify-center whitespace-nowrap select-none border rounded-[var(--radius-md)] font-sans font-medium text-xs outline-none transition-[background-color,border-color,box-shadow,color,transform] duration-150 motion-reduce:transition-none motion-reduce:active:transform-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background-base)] disabled:cursor-not-allowed disabled:opacity-50 [&>*]:text-inherit ${variantClasses[split.variant ?? "secondary"]} ${sizeClasses[toDataSize(split.size)]} ${split.class ?? ""}`}
      classList={split.classList}
    >
      {split.children}
    </button>
  );
}
