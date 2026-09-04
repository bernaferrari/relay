/** @jsxImportSource react */
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "small" | "medium";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, size = "medium", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-slot="button"
      data-variant="ghost"
      data-size={`icon-${size}`}
      className={classNames(
        "relay-icon-button relative inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-text-strong outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-out touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--relay-focus-ring)] hover:bg-[var(--button-ghost-hover)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 before:absolute before:-inset-1",
        size === "small" ? "relay-icon-button--small h-8 w-8" : "relay-icon-button--medium",
        className,
      )}
      {...props}
    />
  );
});
