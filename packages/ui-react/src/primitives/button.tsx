/** @jsxImportSource react */
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { forwardRef } from "react";
import { classNames } from "../lib/class-names";

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & {
  className?: ButtonPrimitive.Props["className"];
  variant?: "primary" | "secondary" | "ghost";
  size?: "small" | "medium";
};

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  { className, nativeButton, render, size = "medium", variant = "secondary", ...props },
  ref,
) {
  const base = `relay-button relay-button--${variant} relay-button--${size}`;
  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      nativeButton={nativeButton ?? !render}
      render={render}
      className={
        typeof className === "function"
          ? (state) => classNames(base, className(state))
          : classNames(base, className)
      }
      {...props}
    />
  );
});
