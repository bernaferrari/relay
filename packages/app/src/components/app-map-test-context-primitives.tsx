import type { JSX } from "solid-js";
import { Icon, type IconName } from "./icon";

export function TestContextMetric(props: { label: string; value: string }) {
  return (
    <span class="grid min-w-0 gap-0.5 bg-surface-base p-2.5">
      <span class="text-[9.5px] text-text-weaker">{props.label}</span>
      <strong class="truncate text-[12px] font-semibold tabular-nums text-text-strong">
        {props.value}
      </strong>
    </span>
  );
}

export function TestContextEmpty(props: {
  icon: Extract<IconName, "smartphone" | "command" | "clock" | "alert">;
  title: string;
  detail: string;
  action?: JSX.Element;
}) {
  return (
    <div class="grid min-h-[180px] place-items-center rounded-xl border border-dashed border-border-weak-base bg-surface-base p-5 text-center">
      <div class="max-w-[38ch]">
        <span class="mx-auto grid size-10 place-items-center rounded-xl bg-background-base text-text-weak">
          <Icon name={props.icon} size={17} />
        </span>
        <strong class="mt-3 block text-[13px] font-semibold text-text-strong">{props.title}</strong>
        <p class="mt-1 text-[11px]/[1.5] text-text-weak">{props.detail}</p>
        {props.action}
      </div>
    </div>
  );
}

export function formatTestContextTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatTestContextDate(value: number): string {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function formatTestContextDuration(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}
