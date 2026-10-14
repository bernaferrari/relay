import { useLayoutEffect, useRef, useState } from "react";

/** A native modal keeps this exact canvas and live session mounted. The browser
 * owns the top layer, background inertness, focus trapping, and Escape. */
export function useLivePreviewFullscreen() {
  const surface = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const wasExpanded = useRef(false);
  useLayoutEffect(() => {
    const dialog = surface.current;
    if (!dialog) return;
    if (!expanded && !wasExpanded.current) return;
    wasExpanded.current = expanded;
    dialog.close();
    if (expanded) dialog.showModal();
    else dialog.show();
    trigger.current?.focus({ preventScroll: true });
  }, [expanded]);
  return { surface, trigger, expanded, setExpanded };
}
