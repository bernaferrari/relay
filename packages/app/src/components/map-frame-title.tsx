import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Fit the full title on one line without changing the frame's geometry. */
export function MapFrameTitle({
  title,
  onRename,
  disabled = false,
  canEdit,
}: {
  title: string;
  onRename?: (title: string) => Promise<void>;
  disabled?: boolean;
  canEdit?: () => boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLSpanElement>(null);
  const settled = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string>();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => {
      node.style.fontSize = "13px";
      const available = node.parentElement?.clientWidth ?? 0;
      const natural = node.scrollWidth;
      if (available && natural > available) node.style.fontSize = `${(13 * available) / natural}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (node.parentElement) observer.observe(node.parentElement);
    return () => observer.disconnect();
  }, [title, editing]);
  useLayoutEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const finish = useCallback(
    (commit: boolean) => {
      if (settled.current) return;
      settled.current = true;
      setEditing(false);
      const next = draft.trim();
      if (commit && next && next !== title)
        void onRename?.(next).catch(() => setError("Couldn’t rename. Try again."));
    },
    [draft, title, onRename],
  );
  useEffect(() => {
    if (!editing) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !editor.current?.contains(event.target)) finish(true);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [editing, finish]);
  const beginEditing = () => {
    if (canEdit && !canEdit()) return;
    settled.current = false;
    setDraft(title);
    setError(undefined);
    setEditing(true);
  };
  const label = (
    <span ref={ref} className="block max-w-full whitespace-nowrap" title={title}>
      {title}
    </span>
  );
  if (!onRename) return label;
  return (
    <span
      ref={editor}
      className="relative min-w-0 max-w-full"
      onPointerDown={(event) => {
        if (editing) event.stopPropagation();
      }}
      onClick={(event) => {
        if (editing) event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (editing) event.stopPropagation();
      }}
    >
      {editing ? (
        <input
          ref={input}
          autoFocus
          aria-label={`Rename ${title}`}
          value={draft}
          className="h-5 w-full min-w-0 rounded-sm bg-background px-1 text-center text-[13px] font-medium leading-tight outline-1 outline-foreground/40 focus-visible:outline-2 focus-visible:outline-foreground/60"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finish(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              finish(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Select title ${title}`}
          title="Drag to move · double-click to rename"
          className="max-w-full cursor-grab active:cursor-grabbing rounded-sm outline-offset-2 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-foreground/60 disabled:cursor-default"
          onKeyDown={(event) => {
            if (event.key === "F2") {
              event.preventDefault();
              event.stopPropagation();
              beginEditing();
            }
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            beginEditing();
          }}
        >
          {label}
        </button>
      )}
      {error ? (
        <span
          role="alert"
          className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-background px-2 py-1 text-xs text-destructive"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
