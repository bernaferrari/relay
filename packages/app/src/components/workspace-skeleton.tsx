/** Pulse placeholders for lazy workspaces. Bare “Loading {label}…” is how
 * a person forms a quality judgment of an otherwise careful product. */
export function WorkspaceSkeleton(props: { label: string }) {
  return (
    <div
      class="grid min-h-0 flex-1 place-items-center bg-[var(--background-deep)] px-6"
      role="status"
      aria-live="polite"
      aria-label={`Loading ${props.label}`}
    >
      <div class="grid w-[min(28rem,72%)] gap-3" aria-hidden="true">
        <div class="h-11 rounded-xl bg-[var(--surface-base)] motion-safe:animate-pulse" />
        <div class="h-40 rounded-xl bg-[var(--surface-base)] motion-safe:animate-pulse" />
        <div class="h-11 w-2/3 justify-self-center rounded-xl bg-[var(--surface-base)] motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
