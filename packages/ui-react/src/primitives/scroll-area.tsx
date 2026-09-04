/** @jsxImportSource react */
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { classNames } from "../lib/class-names";

export function ScrollArea({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & { className?: string }) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={classNames("relay-scroll-area", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="relay-scroll-area-viewport"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props & { className?: string }) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={classNames("relay-scroll-area-scrollbar", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relay-scroll-area-thumb"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
