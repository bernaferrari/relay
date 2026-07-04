import type { JSX } from "solid-js";
import { Show } from "solid-js";

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
  // Simple geometric marks — no emoji clutter
  switch (props.kind) {
    case "server":
      return (
        <span class="empty-state__icon empty-state__icon--server" aria-hidden="true">
          <span class="empty-state__geo empty-state__geo--stack" />
          <span class="empty-state__geo empty-state__geo--stack" />
          <span class="empty-state__geo empty-state__geo--dot" />
        </span>
      );
    case "device":
      return (
        <span class="empty-state__icon empty-state__icon--device" aria-hidden="true">
          <span class="empty-state__geo empty-state__geo--phone" />
        </span>
      );
    case "frame":
      return (
        <span class="empty-state__icon empty-state__icon--frame" aria-hidden="true">
          <span class="empty-state__geo empty-state__geo--rect" />
          <span class="empty-state__geo empty-state__geo--rect empty-state__geo--rect-sm" />
        </span>
      );
    case "run":
      return (
        <span class="empty-state__icon empty-state__icon--run" aria-hidden="true">
          <span class="empty-state__geo empty-state__geo--play" />
        </span>
      );
    case "artifact":
      return (
        <span class="empty-state__icon empty-state__icon--artifact" aria-hidden="true">
          <span class="empty-state__geo empty-state__geo--folder" />
        </span>
      );
    default:
      return (
        <span class="empty-state__icon empty-state__icon--info" aria-hidden="true">
          <span class="empty-state__geo empty-state__geo--circle" />
        </span>
      );
  }
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
