import { Show, createMemo } from "solid-js";
import { Button } from "@relay/ui/button";
import type { AppMapPrimaryAction } from "../lib/app-map-primary-action";
import { appMapPrimaryActionControl } from "../lib/app-map-primary-action-control";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export function AppMapPrimaryActionButton(props: {
  action: AppMapPrimaryAction;
  fallbackTip: string;
  onActivate: () => void;
}) {
  const control = createMemo(() => appMapPrimaryActionControl(props.action, props.onActivate));

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        class="text-caption aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        aria-describedby={control().describedBy}
        aria-disabled={control().blocked ? "true" : undefined}
        data-tip={control().reason || props.fallbackTip}
        aria-label={control().label}
        onClick={(event) => {
          if (control().blocked) event.preventDefault();
          control().activate();
        }}
      >
        <Icon
          name={props.action.icon}
          size={13}
          class={cn(props.action.icon === "refresh" && "ui-refresh-spin motion-reduce:opacity-70")}
        />
        {/* The complete label remains the accessible name and tooltip. Compact
            windows keep one unambiguous icon action instead of letting this
            long, state-dependent label collide with workspace navigation. */}
        <span class="max-[1320px]:hidden">{control().label}</span>
      </Button>
      <Show when={control().reason}>
        {(reason) => (
          <span id="app-map-primary-action-reason" class="sr-only">
            {reason()}
          </span>
        )}
      </Show>
    </>
  );
}
