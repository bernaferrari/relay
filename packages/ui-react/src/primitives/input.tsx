/** @jsxImportSource react */
import { Input as InputPrimitive } from "@base-ui/react/input";
import { forwardRef, type ComponentProps } from "react";
import { classNames } from "../lib/class-names";

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(
  { className, type, ...props },
  ref,
) {
  return (
    <InputPrimitive
      ref={ref}
      type={type}
      data-slot="input"
      className={classNames(
        "relay-input block h-9 w-full rounded-md border border-border-base bg-input-base px-3 py-1 text-base text-text-strong shadow-xs outline-none placeholder:text-text-weaker focus-visible:border-[var(--relay-focus-ring)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_srgb,var(--relay-focus-ring)_20%,transparent)] disabled:cursor-not-allowed disabled:bg-input-disabled disabled:text-text-weaker disabled:opacity-50 motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11",
        className,
      )}
      {...props}
    />
  );
});
