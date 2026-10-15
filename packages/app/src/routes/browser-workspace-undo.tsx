/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Button } from "@relay/ui-react/components/button";
import { Undo2, X } from "lucide-react";

export function BrowserWorkspaceUndo({
  name,
  pending,
  full,
  onUndo,
  onDismiss,
}: {
  name: string;
  pending: boolean;
  full: boolean;
  onUndo(): void;
  onDismiss(): void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || pending) return;
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [name, paused, pending, onDismiss]);
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 z-40 flex justify-center">
      <div
        role="status"
        aria-live="polite"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
        }}
        className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl border border-border bg-popover py-2 pr-2 pl-4 text-sm text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-150"
      >
        <span className="min-w-0 truncate">{name} removed</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={pending || full}
          title={full ? "Make room in the workspace to restore this browser" : undefined}
        >
          <Undo2 aria-hidden="true" /> Undo
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          disabled={pending}
          aria-label="Dismiss undo"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
