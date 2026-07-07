import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Icon, type IconName } from "./icon";

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

function EmptyIcon(props: { kind: NonNullable<EmptyStateProps["icon"]> }) {
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
    <span class="empty-state__icon" aria-hidden="true">
      <Icon name={name()} size={22} strokeWidth={1.5} />
    </span>
  );
}

/** Calm empty / zero-state used across stage, panel, and pickers. */
export function EmptyState(props: EmptyStateProps) {
  const size = () => props.size ?? "md";
  return (
    <div
      class={`empty-state empty-state--${size()}${props.class ? ` ${props.class}` : ""}`}
      role="status"
    >
      <Show when={props.icon}>
        <EmptyIcon kind={props.icon!} />
      </Show>
      <div class="empty-state__copy">
        <p class="empty-state__title">{props.title}</p>
        <Show when={props.description}>
          <p class="empty-state__desc">{props.description}</p>
        </Show>
        <Show when={props.code}>
          <code class="empty-state__code mono">{props.code}</code>
        </Show>
      </div>
      <Show when={props.actionLabel || props.secondaryLabel || props.children}>
        <div class="empty-state__actions">
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
