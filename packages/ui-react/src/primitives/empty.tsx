/** @jsxImportSource react */
import { forwardRef, type HTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

export const Empty = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Empty(
  { className, ...props },
  ref,
) {
  return (
    <div ref={ref} data-slot="empty" className={classNames("relay-empty", className)} {...props} />
  );
});

export const EmptyHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function EmptyHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="empty-header"
        className={classNames("relay-empty-header", className)}
        {...props}
      />
    );
  },
);

export const EmptyMedia = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function EmptyMedia({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="empty-media"
        className={classNames("relay-empty-media", className)}
        aria-hidden="true"
        {...props}
      />
    );
  },
);

export const EmptyTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function EmptyTitle({ className, ...props }, ref) {
    return (
      <h2
        ref={ref}
        data-slot="empty-title"
        className={classNames("relay-empty-title", className)}
        {...props}
      />
    );
  },
);

export const EmptyDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function EmptyDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      data-slot="empty-description"
      className={classNames("relay-empty-description", className)}
      {...props}
    />
  );
});

export const EmptyContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function EmptyContent({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="empty-content"
        className={classNames("relay-empty-content", className)}
        {...props}
      />
    );
  },
);
