/** @jsxImportSource react */
import { forwardRef, type HTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

export type BadgeVariant = "default" | "secondary" | "success" | "warning" | "danger" | "outline";

export const Badge = forwardRef<
  HTMLElement,
  HTMLAttributes<HTMLElement> & { variant?: BadgeVariant }
>(function Badge({ className, variant = "default", ...props }, ref) {
  return (
    <span
      ref={ref}
      data-slot="badge"
      data-variant={variant}
      className={classNames("relay-badge", `relay-badge--${variant}`, className)}
      {...props}
    />
  );
});
