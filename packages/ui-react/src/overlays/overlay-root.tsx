/** @jsxImportSource react */
import { Tooltip } from "@base-ui/react/tooltip";
import { createContext, useContext, useRef, type PropsWithChildren, type RefObject } from "react";

const OverlayContainerContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function OverlayRoot({ children }: PropsWithChildren) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <OverlayContainerContext.Provider value={containerRef}>
      <Tooltip.Provider delay={350} closeDelay={80} timeout={400}>
        {children}
        <div ref={containerRef} className="relay-overlay-root" data-relay-overlay-root />
      </Tooltip.Provider>
    </OverlayContainerContext.Provider>
  );
}

export function useOverlayContainer(): RefObject<HTMLDivElement | null> {
  const container = useContext(OverlayContainerContext);
  if (!container) throw new Error("Overlay portals must be rendered inside OverlayRoot");
  return container;
}
