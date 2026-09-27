/** @jsxImportSource react */

/** Relay's mark: a baton passed between two arcs. */
export function RelayMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-brand" />
      <path
        d="M9 20.5c0-5.2 4.3-9.5 9.5-9.5"
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
        className="stroke-brand-foreground"
      />
      <path
        d="M23 11.5c0 5.2-4.3 9.5-9.5 9.5"
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
        className="stroke-brand-foreground opacity-60"
      />
      <circle cx="18.5" cy="11" r="2.4" className="fill-brand-foreground" />
    </svg>
  );
}

export function RelayWordmark() {
  return (
    <span className="flex items-center gap-2">
      <RelayMark className="size-6" />
      <span className="text-base font-semibold tracking-tight">Relay</span>
    </span>
  );
}
