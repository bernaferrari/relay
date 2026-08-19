import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { mono } from "../lib/ui";
import { Icon, type IconName } from "./icon";

export type EmptyStateProps = {
  title: string;
  description?: string;
  /** Optional mono command / path line under description */
  code?: string;
  /** Optional quiet visual anchor for workspace-level empty states. */
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Empty states inside a workspace that already shows a filled primary in its
   * chrome demote their action, so a view never presents two equally loud next
   * steps. Standalone gates keep the primary.
   */
  actionVariant?: "primary" | "secondary";
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** compact = list/panel; full = stage/gate; start = document left-aligned (default for panels) */
  size?: "sm" | "md" | "lg";
  /** Left-aligned document empty vs centered. */
  align?: "start" | "center";
  /** Quiet panel/rail treatment without a card-sized visual anchor. */
  appearance?: "default" | "quiet";
  class?: string;
  children?: JSX.Element;
};

/**
 * One empty-state language for workspaces and panels: a quiet visual anchor,
 * concise explanation, and at most one primary next step.
 */
export function EmptyState(props: EmptyStateProps) {
  const size = () => props.size ?? "md";
  const align = () => props.align ?? "center";
  const quiet = () => props.appearance === "quiet";
  return (
    <div
      class={cn(
        "flex flex-col",
        align() === "start" ? "items-start text-left" : "items-center text-center",
        quiet()
          ? "gap-1 px-3 py-5"
          : size() === "sm"
            ? "gap-1.5 px-3 py-5"
            : size() === "lg"
              ? "gap-2 px-6 py-10"
              : "gap-1.5 px-4 py-8",
        props.class,
      )}
      role="status"
    >
      <Show when={quiet() ? undefined : props.icon}>
        {(icon) => (
          <span
            class={cn(
              "grid shrink-0 place-items-center rounded-xl bg-surface-raised-strong text-text-weak ring-1 ring-inset ring-border-weak-base",
              size() === "sm" ? "mb-1 size-9" : size() === "lg" ? "mb-2 size-11" : "mb-1.5 size-10",
            )}
            aria-hidden="true"
          >
            <Icon name={icon()} size={size() === "lg" ? 18 : 16} />
          </span>
        )}
      </Show>
      <div
        class={cn("flex flex-col", align() === "start" ? "items-start" : "items-center", "gap-1")}
      >
        <p
          class={cn(
            "m-0 tracking-tight text-text-strong",
            quiet()
              ? "text-caption font-medium"
              : size() === "sm"
                ? "text-caption font-medium"
                : size() === "lg"
                  ? "text-title font-semibold tracking-[-0.02em]"
                  : "text-body font-medium",
          )}
        >
          {props.title}
        </p>
        <Show when={props.description}>
          {/* `pretty` keeps the last line from stranding a single word, which
              on a three-line explanation is the difference between a designed
              paragraph and a wrapped string. */}
          <p
            class={cn(
              "m-0 text-pretty text-text-base",
              quiet() || size() === "sm" ? "max-w-[260px] text-caption" : "max-w-[300px] text-body",
            )}
          >
            {props.description}
          </p>
        </Show>
        <Show when={props.code}>
          <code
            class={cn(
              mono,
              "mt-2 rounded-md bg-surface-base px-2.5 py-1 text-caption text-text-strong shadow-xs-border-base",
            )}
          >
            {props.code}
          </code>
        </Show>
      </div>
      <Show when={props.actionLabel || props.secondaryLabel || props.children}>
        <div
          class={cn(
            "flex items-center gap-2",
            align() === "start" ? "justify-start" : "justify-center",
            size() === "sm" ? "mt-2.5" : "mt-3.5",
          )}
        >
          <Show when={props.actionLabel && props.onAction}>
            <Button
              variant={props.actionVariant ?? "primary"}
              size="normal"
              onClick={() => props.onAction?.()}
            >
              {props.actionLabel}
            </Button>
          </Show>
          <Show when={props.secondaryLabel && props.onSecondary}>
            <button
              type="button"
              class="h-7 px-2 text-caption font-medium text-text-base transition-colors hover:text-text-strong"
              onClick={() => props.onSecondary?.()}
            >
              {props.secondaryLabel}
            </button>
          </Show>
          {props.children}
        </div>
      </Show>
    </div>
  );
}
