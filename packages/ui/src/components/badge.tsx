import { type ComponentProps, splitProps } from "solid-js";
import "./badge.css";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger";

export interface BadgeProps extends ComponentProps<"span"> {
  variant?: BadgeVariant;
}

export function Badge(props: BadgeProps) {
  const [split, rest] = splitProps(props, ["variant", "class", "classList", "children"]);
  return (
    <span
      {...rest}
      data-component="badge"
      data-variant={split.variant || "neutral"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </span>
  );
}
