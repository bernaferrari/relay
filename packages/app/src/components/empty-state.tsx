import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Icon, type IconName } from "./icon";
import { cn } from "../lib/cn";

export type EmptyStateProps = {
  title: string;
  description?: string;
  /** Optional mono command / path line under description */
  code?: string;
  icon?: "server" | "device" | "frame" | "run" | "artifact" | "info";
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** compact = list/panel; full = stage/gate */
  size?: "sm" | "md" | "lg";
  class?: string;
  children?: JSX.Element;
};

function EmptyIcon(props: {
  kind: NonNullable<EmptyStateProps["icon"]>;
  size: "sm" | "md" | "lg";
}) {
  const name = (): IconName => {
    switch (props.kind) {
      case "server":
        return "server";
      case "device":
        return "smartphone";
      case "frame":
        return "camera";
      case "run":
        return "command";
      case "artifact":
        return "folder";
      default:
        return "info";
    }
  };
  return (
    <span
      class={cn(
        "mb-0.5 grid place-items-center rounded-[10px] border border-accent/20 bg-accent/10 text-accent-soft",
        props.size === "sm" ? "size-[38px]" : "size-9",
      )}
      aria-hidden="true"
    >
      <Icon name={name()} size={22} strokeWidth={1.5} />
    </span>
  );
}

/** Calm empty / zero-state used across stage, panel, and pickers. */
export function EmptyState(props: EmptyStateProps) {
  const size = () => props.size ?? "md";
  return (
    <div
      class={cn(
        "flex flex-col items-center gap-1 text-center",
        size() === "sm" ? "px-3 py-6" : "px-4 py-[18px]",
        props.class,
      )}
      role="status"
    >
      <Show when={props.icon}>
        <EmptyIcon kind={props.icon!} size={size()} />
      </Show>
      <div class="flex flex-col items-center gap-0.5">
        <p class="m-0 text-title font-semibold text-text">{props.title}</p>
        <Show when={props.description}>
          <p class="m-0 max-w-[300px] text-meta leading-[1.55] text-text-faint">
            {props.description}
          </p>
        </Show>
        <Show when={props.code}>
          <code class="mono mt-2 rounded-md bg-layer-2 px-2 py-0.5 text-meta text-accent-soft">
            {props.code}
          </code>
        </Show>
      </div>
      <Show when={props.actionLabel || props.secondaryLabel || props.children}>
        <div class="mt-3 flex gap-2">
          <Show when={props.actionLabel && props.onAction}>
            <button type="button" class="btn btn-acc" onClick={() => props.onAction?.()}>
              {props.actionLabel}
            </button>
          </Show>
          <Show when={props.secondaryLabel && props.onSecondary}>
            <button type="button" class="btn btn-ghost" onClick={() => props.onSecondary?.()}>
              {props.secondaryLabel}
            </button>
          </Show>
          {props.children}
        </div>
      </Show>
    </div>
  );
}
