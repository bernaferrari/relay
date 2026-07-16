import type { JSX } from "solid-js";
import { cn } from "../lib/cn";
import { listRow, listRowActive } from "../lib/ui";

/** Canonical single-selection row used by library and navigation lists. */
export function SelectableRow(props: {
  selected: boolean;
  onClick: () => void;
  children: JSX.Element;
  class?: string;
  title?: string;
  current?: "page" | "step";
}) {
  return (
    <button
      type="button"
      class={cn(
        listRow,
        "w-full text-left outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
        props.selected && listRowActive,
        props.class,
      )}
      aria-current={props.selected ? (props.current ?? "page") : undefined}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
