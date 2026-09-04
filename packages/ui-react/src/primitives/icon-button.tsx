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
      className={classNames("relay-icon-button", `relay-icon-button--${size}`, className)}
      {...props}
    />
  );
});
