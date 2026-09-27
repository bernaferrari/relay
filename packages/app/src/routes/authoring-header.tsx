import type { ReactNode } from "react";

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
  phase?: "setup" | "record" | "review";
  back?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="shrink-0">
      <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {back}
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
            {phase ? (
              <ol className="sr-only" aria-label="Recording progress">
                {(
                  [
                    ["setup", "Set up"],
                    ["record", "Record"],
                    ["review", "Review"],
                  ] as const
                ).map(([id, label], index) => (
                  <li
                    key={id}
                    className={phase === id ? "flex items-center gap-3" : "sr-only"}
                    aria-current={phase === id ? "step" : undefined}
                  >
                    <span aria-hidden="true" className="text-border">
                      /
                    </span>
                    <span>{label}</span>
                    <span className="sr-only">Step {index + 1} of 3</span>
                  </li>
                ))}
              </ol>
            ) : null}
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
