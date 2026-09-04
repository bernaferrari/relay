/** @jsxImportSource react */
import { forwardRef, type HTMLAttributes, type LabelHTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

export const Field = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Field(
  { className, ...props },
  ref,
) {
  return (
    <div ref={ref} data-slot="field" className={classNames("relay-field", className)} {...props} />
  );
});

export const FieldLabel = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function FieldLabel({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        data-slot="field-label"
        className={classNames("relay-field-label", className)}
        {...props}
      />
    );
  },
);

export const FieldDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function FieldDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      data-slot="field-description"
      className={classNames("relay-field-description", className)}
      {...props}
    />
  );
});

export const FieldError = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function FieldError({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        data-slot="field-error"
        className={classNames("relay-field-error", className)}
        role="alert"
        {...props}
      />
    );
  },
);
