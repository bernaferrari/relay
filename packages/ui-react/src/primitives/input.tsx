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
      className={classNames("relay-input", className)}
      {...props}
    />
  );
});
