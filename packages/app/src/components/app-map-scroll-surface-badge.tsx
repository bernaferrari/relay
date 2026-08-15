import { Icon } from "./icon";

/** A quiet cue that several captures still represent one mapped screen. */
export function AppMapScrollSurfaceBadge(props: { viewportCount: number; complete: boolean }) {
  return (
    <span class="pointer-events-none absolute bottom-2 left-2 inline-flex min-h-6 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] px-2 text-[9px] font-medium text-[var(--text-strong)] shadow-[0_1px_5px_rgb(0_0_0/12%)] backdrop-blur-sm">
      <Icon name="grid" size={9} />
      {props.complete ? "Full page" : "Partial page"} · {props.viewportCount}
    </span>
  );
}
