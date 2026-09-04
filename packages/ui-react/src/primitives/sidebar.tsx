/** @jsxImportSource react */
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

export const SidebarProvider = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function SidebarProvider({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="sidebar-wrapper"
        className={classNames("relay-sidebar-provider", className)}
        {...props}
      />
    );
  },
);

export const SidebarRoot = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function SidebarRoot({ className, ...props }, ref) {
    return (
      <aside
        ref={ref}
        data-slot="sidebar"
        className={classNames("relay-sidebar-root", className)}
        {...props}
      />
    );
  },
);

function sidebarPart(slot: string, baseClassName: string) {
  return forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function SidebarPart(
    { className, ...props },
    ref,
  ) {
    return (
      <div ref={ref} data-slot={slot} className={classNames(baseClassName, className)} {...props} />
    );
  });
}

export const SidebarHeader = sidebarPart("sidebar-header", "relay-sidebar-header");
export const SidebarContent = sidebarPart("sidebar-content", "relay-sidebar-content");
export const SidebarGroup = sidebarPart("sidebar-group", "relay-sidebar-group");
export const SidebarGroupLabel = sidebarPart("sidebar-group-label", "relay-sidebar-group-label");
export const SidebarFooter = sidebarPart("sidebar-footer", "relay-sidebar-footer");

export const SidebarMenu = forwardRef<HTMLUListElement, HTMLAttributes<HTMLUListElement>>(
  function SidebarMenu({ className, ...props }, ref) {
    return (
      <ul
        ref={ref}
        data-slot="sidebar-menu"
        className={classNames("relay-sidebar-menu", className)}
        {...props}
      />
    );
  },
);

export const SidebarMenuItem = forwardRef<HTMLLIElement, HTMLAttributes<HTMLLIElement>>(
  function SidebarMenuItem({ className, ...props }, ref) {
    return (
      <li
        ref={ref}
        data-slot="sidebar-menu-item"
        className={classNames("relay-sidebar-menu-item", className)}
        {...props}
      />
    );
  },
);

export function SidebarMenuButton({
  render,
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean }) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      { className: classNames("relay-sidebar-menu-button", className) },
      props,
    ),
    render,
    state: {
      slot: "sidebar-menu-button",
      active: isActive,
    },
  });
}
