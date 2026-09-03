import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "../lib/cn";

type ScrollAreaElement = "article" | "div" | "nav" | "section";

export interface ScrollAreaProps extends JSX.HTMLAttributes<HTMLElement> {
  as?: ScrollAreaElement;
}

/**
 * Relay's bounded, native scroll surface.
 *
 * Native scrolling preserves keyboard, pointer, touch, and assistive-technology
 * behavior. The shared treatment makes nested panes visibly scrollable without
 * replacing the browser's page scrollbar.
 */
export function ScrollArea(props: ScrollAreaProps) {
  const [local, rest] = splitProps(props, ["as", "class", "classList", "children"]);

  return (
    <Dynamic
      component={local.as ?? "div"}
      {...rest}
      data-component="scroll-area"
      class={cn(
        "app-scroll-area min-h-0 min-w-0 overflow-auto overscroll-contain [scrollbar-gutter:stable]",
        local.class,
      )}
      classList={local.classList}
    >
      {local.children}
    </Dynamic>
  );
}
