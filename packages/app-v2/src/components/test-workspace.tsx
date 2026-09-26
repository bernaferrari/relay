import type { ReactNode } from "react";

/** The same spatial model for authored steps and their execution evidence. */
export function TestWorkspace({ outline, preview }: { outline: ReactNode; preview: ReactNode }) {
  return (
    <div className="@container/workspace flex min-h-0 min-w-0 flex-1" data-slot="test-workspace">
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(20rem,1fr)] @2xl/workspace:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] @2xl/workspace:grid-rows-1">
        <div
          data-slot="workspace-outline"
          className="flex min-h-0 min-w-0 flex-col overflow-auto border-b border-border bg-card @2xl/workspace:border-r @2xl/workspace:border-b-0"
        >
          {outline}
        </div>
        <div
          data-slot="workspace-preview"
          className="flex min-h-0 min-w-0 flex-col overflow-auto bg-stage"
        >
          {preview}
        </div>
      </div>
    </div>
  );
}

export function TestWorkspaceHeader({
  title,
  context,
  actions,
  children,
}: {
  title: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header data-slot="test-workspace-header" className="shrink-0 px-5 py-4">
      {context ? (
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {context}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1 className="min-w-0 flex-1 basis-64 text-xl leading-snug font-semibold tracking-tight break-words">
          {title}
        </h1>
        {actions ? (
          <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {children}
        </div>
      ) : null}
    </header>
  );
}

/** A selectable step; the caller supplies authoring or execution details. */
export function TestStepButton({
  number,
  selected,
  children,
  ...props
}: import("react").ComponentProps<"button"> & { number: string; selected: boolean }) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={selected}
      className="grid w-full min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 rounded-md px-2 py-2.5 text-left text-sm outline-none hover:bg-accent/40 aria-pressed:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="pt-0.5 text-center text-xs text-muted-foreground tabular-nums">
        {number}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

/** Original capture, without decorative browser or phone chrome. */
export function WorkspaceScreenshot({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <figure data-slot="evidence-image-frame" className="mx-auto grid w-full gap-3">
      <div className="overflow-hidden rounded-lg border border-border bg-card [&>img]:block [&>img]:h-auto [&>img]:w-full [&>div>img]:block [&>div>img]:h-auto [&>div>img]:w-full">
        {children}
      </div>
      {caption ? (
        <figcaption className="text-center text-sm text-muted-foreground">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

/** Reserve the same rows before and after data arrives; respond to pane width. */
export function WorkspaceToolbar({
  leading,
  trailing,
}: {
  leading: ReactNode;
  trailing: ReactNode;
}) {
  return (
    <div className="@container/toolbar shrink-0 border-b border-border px-5">
      <div className="grid min-w-0 grid-cols-1 items-center gap-x-4 @3xl/toolbar:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex min-h-12 min-w-0 items-center">{leading}</div>
        <div className="flex min-h-12 min-w-0 items-center pb-2 @3xl/toolbar:justify-end @3xl/toolbar:pb-0">
          {trailing}
        </div>
      </div>
    </div>
  );
}
