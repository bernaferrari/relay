/** @jsxImportSource react */
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "small" | "medium";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, size = "medium", type = "button", variant = "secondary", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classNames(
        "relay-button",
        `relay-button--${variant}`,
        `relay-button--${size}`,
        className,
      )}
      {...props}
    />
  );
});
