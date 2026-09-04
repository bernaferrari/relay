/** @jsxImportSource react */
import { useRender } from "@base-ui/react/use-render";
import { forwardRef, type HTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

type ItemState = {
  variant: "default" | "outline" | "muted";
  size: "default" | "small" | "compact";
};

export type ItemProps = useRender.ComponentProps<"div", ItemState> & Partial<ItemState>;

export const Item = forwardRef<HTMLElement, ItemProps>(function Item(
  { className, render, size = "default", variant = "default", ...props },
  ref,
) {
  return useRender<ItemState, HTMLElement>({
    defaultTagName: "div",
    render,
    ref,
    state: { size, variant },
    props: {
      ...props,
      "data-slot": "item",
      className: classNames("relay-item", className as string),
    },
  });
});

export const ItemGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ItemGroup({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="item-group"
        className={classNames("relay-item-group", className)}
        {...props}
      />
    );
  },
);

export const ItemMedia = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function ItemMedia({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="item-media"
        className={classNames("relay-item-media", className)}
        {...props}
      />
    );
  },
);

export const ItemContent = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function ItemContent({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="item-content"
        className={classNames("relay-item-content", className)}
        {...props}
      />
    );
  },
);

export const ItemTitle = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function ItemTitle({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="item-title"
        className={classNames("relay-item-title", className)}
        {...props}
      />
    );
  },
);

export const ItemDescription = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function ItemDescription({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="item-description"
        className={classNames("relay-item-description", className)}
        {...props}
      />
    );
  },
);

export const ItemActions = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function ItemActions({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="item-actions"
        className={classNames("relay-item-actions", className)}
        {...props}
      />
    );
  },
);

export const ItemSeparator = forwardRef<HTMLHRElement, HTMLAttributes<HTMLHRElement>>(
  function ItemSeparator({ className, ...props }, ref) {
    return (
      <hr
        ref={ref}
        data-slot="item-separator"
        className={classNames("relay-item-separator", className)}
        {...props}
      />
    );
  },
);
