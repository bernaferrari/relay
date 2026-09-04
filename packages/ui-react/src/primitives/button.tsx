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
  const base = classNames(
    "relay-button inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent px-4 py-2 text-[13px] font-medium leading-none text-text-strong shadow-xs outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-out touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--relay-focus-ring)] data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    variant === "primary"
      ? "bg-[var(--button-primary-base)] text-[var(--button-primary-foreground)] hover:bg-[var(--button-primary-hover)] active:bg-[var(--button-primary-active)]"
      : variant === "ghost"
        ? "bg-transparent shadow-none hover:bg-[var(--button-ghost-hover)]"
        : "border-border-weak-base bg-[var(--button-secondary-base)] shadow-xs hover:border-border-hover hover:bg-[var(--button-secondary-hover)]",
    size === "small" ? "h-8 gap-1.5 px-3" : null,
    `relay-button--${variant}`,
    `relay-button--${size}`,
  );
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
