import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** The same navigation and action hierarchy follows a test through authoring. */
export function AuthoringHeader({
  title,
  phase,
  back,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  phase: "setup" | "record" | "review";
  back?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-border/60">
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {back}
          <div className="grid min-w-0 gap-1">
            <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
            <ol
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              aria-label="Recording progress"
            >
              {(
                [
                  ["setup", "Set up"],
                  ["record", "Record"],
                  ["review", "Review"],
                ] as const
              ).map(([id, label], index) => (
                <li
                  key={id}
                  className="flex items-center gap-1.5"
                  aria-current={phase === id ? "step" : undefined}
                >
                  {index ? <ChevronRight className="size-3 opacity-50" aria-hidden="true" /> : null}
                  <span className={phase === id ? "font-medium text-foreground" : ""}>{label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      {description ? (
        <div className="px-4 pb-3 text-xs text-muted-foreground">{description}</div>
      ) : null}
      {children ? <div className="border-t border-border/60 px-4 py-3">{children}</div> : null}
    </header>
  );
}
