import { Icon } from "./icon";
import type { ScrollSurfaceClassification } from "@relay/protocol";

/** A quiet cue that several captures still represent one mapped screen. */
export function AppMapScrollSurfaceBadge(props: {
  viewportCount: number;
  classification: ScrollSurfaceClassification;
}) {
  const label = () =>
    ({
      complete: "Full page",
      partial: "Partial page",
      dynamic: "Dynamic page",
      unsupported: "Unsupported page",
    })[props.classification];
  return (
    <span class="pointer-events-none absolute bottom-2 left-2 inline-flex min-h-6 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] px-2 text-micro font-medium text-[var(--text-strong)] shadow-[0_1px_5px_rgb(0_0_0/12%)] backdrop-blur-sm">
      <Icon name="grid" size={9} />
      {label()} · {props.viewportCount}
    </span>
  );
}
