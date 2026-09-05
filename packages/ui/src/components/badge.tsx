import { type ComponentProps, splitProps } from "solid-js";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger";

export interface BadgeProps extends ComponentProps<"span"> {
  variant?: BadgeVariant;
}

const variants = {
  neutral: "bg-[var(--surface-base)] text-[var(--text-base)]",
  success: "bg-[var(--surface-success-base)] text-[var(--text-success-base)]",
  warning: "bg-[var(--surface-warning-base)] text-[var(--text-warning-base)]",
  danger: "bg-[var(--surface-critical-base)] text-[var(--text-critical-base)]",
};

export function Badge(props: BadgeProps) {
  const [split, rest] = splitProps(props, ["variant", "class", "classList", "children"]);
  return (
    <span
      {...rest}
      data-component="badge"
      data-variant={split.variant || "neutral"}
      class={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-xl border border-current/20 px-1.5 py-0.5 font-sans text-xs font-medium whitespace-nowrap select-none [&>*]:min-w-0 [&>*]:truncate ${variants[split.variant ?? "neutral"]} ${split.class ?? ""}`}
      classList={split.classList}
    >
      {split.children}
    </span>
  );
}
