/** @jsxImportSource react */
import type { ReactNode } from "react";
import { ImageOff } from "lucide-react";

/**
 * One quiet stand-in wherever a screen would be: a dashed frame the size of a
 * screenshot, so an empty stage still reads as "a screen goes here", not a gap.
 */
export function ScreenshotPlaceholder({
  title,
  detail,
  action,
  size = "md",
}: {
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
}) {
  const small = size === "sm";
  return (
    <div
      data-slot="screenshot-placeholder"
      className="grid w-full justify-items-center gap-3 px-6 text-center"
      role="status"
    >
      <div
        aria-hidden="true"
        className={`grid aspect-[4/3] place-items-center rounded-xl border border-dashed border-border bg-card/60 ${small ? "w-28" : "w-44"}`}
      >
        <span className="grid gap-1.5 justify-items-center text-muted-foreground/70">
          <ImageOff className={small ? "size-4" : "size-5"} />
          {small ? null : (
            <span className="grid w-20 gap-1">
              <span className="h-1 w-full rounded-full bg-border" />
              <span className="h-1 w-2/3 rounded-full bg-border" />
            </span>
          )}
        </span>
      </div>
      <div className="grid max-w-72 gap-1">
        <p className={`font-medium text-foreground ${small ? "text-xs" : "text-sm"}`}>{title}</p>
        {detail ? <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}
