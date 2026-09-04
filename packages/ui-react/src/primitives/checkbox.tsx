/** @jsxImportSource react */
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { forwardRef, type ReactNode } from "react";
import { classNames } from "../lib/class-names";

export type CheckboxProps = CheckboxPrimitive.Root.Props;

export const Checkbox = forwardRef<HTMLElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      data-slot="checkbox"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-checkbox", className(state))
          : classNames("relay-checkbox", className)
      }
      {...props}
    >
      <CheckboxPrimitive.Indicator className="relay-checkbox-indicator">
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="m3.25 8.25 3 3 6.5-6.5" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export function CheckboxCard({
  title,
  description,
  className,
  ...props
}: Omit<CheckboxProps, "children"> & {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={classNames("relay-checkbox-card", className)}
      data-disabled={props.disabled || undefined}
    >
      <span className="relay-checkbox-card-copy">
        <span className="relay-checkbox-card-title">{title}</span>
        {description ? (
          <span className="relay-checkbox-card-description">{description}</span>
        ) : null}
      </span>
      <Checkbox {...props} />
    </label>
  );
}
