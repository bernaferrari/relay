/** @jsxImportSource react */
import { forwardRef, type HTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

export type AlertVariant = "default" | "info" | "success" | "warning" | "danger";

export const Alert = forwardRef<
  HTMLElement,
  HTMLAttributes<HTMLElement> & { variant?: AlertVariant }
>(function Alert({ className, variant = "default", ...props }, ref) {
  return (
    <section
      ref={ref}
      data-slot="alert"
      data-variant={variant}
      className={classNames("relay-alert", `relay-alert--${variant}`, className)}
      {...props}
    />
  );
});

export const AlertIcon = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AlertIcon({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="alert-icon"
        className={classNames("relay-alert-icon", className)}
        aria-hidden="true"
        {...props}
      />
    );
  },
);

export const AlertTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function AlertTitle({ className, ...props }, ref) {
    return (
      <h2
        ref={ref}
        data-slot="alert-title"
        className={classNames("relay-alert-title", className)}
        {...props}
      />
    );
  },
);

export const AlertDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AlertDescription({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="alert-description"
        className={classNames("relay-alert-description", className)}
        {...props}
      />
    );
  },
);

export const AlertActions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AlertActions({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="alert-actions"
        className={classNames("relay-alert-actions", className)}
        {...props}
      />
    );
  },
);
