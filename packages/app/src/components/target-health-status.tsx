import type { TargetSupervisorHealth } from "@relay/protocol";
import { For, type JSX } from "solid-js";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "./icon";

type HealthTone = "ready" | "progress" | "attention" | "blocked";
type HealthPlane = {
  id: "overall" | "pixels" | "semantics" | "input";
  label: string;
  value: string;
  detail: string;
  tone: HealthTone;
};

export type TargetHealthStatusModel = { planes: HealthPlane[] };

const OVERALL_COPY: Record<TargetSupervisorHealth["overall"], Omit<HealthPlane, "id" | "label">> = {
  starting: {
    value: "Starting",
    detail: "Relay is preparing this device.",
    tone: "progress",
  },
  ready: { value: "Ready", detail: "Pixels, labels, and input are ready.", tone: "ready" },
  "pixel-only": {
    value: "Pixels only",
    detail: "The screen remains usable while labels are unavailable.",
    tone: "attention",
  },
  recovering: {
    value: "Recovering",
    detail: "Relay is restoring one device capability.",
    tone: "progress",
  },
  "needs-human": {
    value: "Needs help",
    detail: "Keep the device unlocked and review the recovery guidance.",
    tone: "attention",
  },
  quarantined: {
    value: "Unavailable",
    detail: "Relay stopped device control until its state is reviewed.",
    tone: "blocked",
  },
};

/** Product copy for the server-owned health actor. This is intentionally a
 * projection only: no readiness or recovery policy is reimplemented here. */
export function targetHealthStatusModel(health: TargetSupervisorHealth): TargetHealthStatusModel {
  const overall = OVERALL_COPY[health.overall];
  return {
    planes: [
      { id: "overall", label: "Overall", ...overall },
      {
        id: "pixels",
        label: "Pixels",
        value:
          health.pixels.state === "ready"
            ? "Live"
            : health.pixels.state === "delayed"
              ? "Delayed"
              : "Unavailable",
        detail:
          health.pixels.state === "ready"
            ? "The device screen is available."
            : health.pixels.state === "delayed"
              ? "The last screen remains visible while new pixels arrive."
              : "Relay cannot currently read the device screen.",
        tone:
          health.pixels.state === "ready"
            ? "ready"
            : health.pixels.state === "delayed"
              ? "attention"
              : "blocked",
      },
      {
        id: "semantics",
        label: "Labels",
        value:
          health.semantics.state === "current"
            ? "Current"
            : health.semantics.state === "stale"
              ? "Stale"
              : health.semantics.state === "refreshing"
                ? "Refreshing"
                : health.semantics.state === "wedged"
                  ? "Stuck"
                  : "Unavailable",
        detail:
          health.semantics.state === "current"
            ? "Element names and positions are current."
            : health.semantics.state === "refreshing"
              ? "Relay is reading fresh element names."
              : health.semantics.state === "stale"
                ? "The saved labels may not match the visible screen."
                : "Pixels can remain usable without element labels.",
        tone:
          health.semantics.state === "current"
            ? "ready"
            : health.semantics.state === "refreshing"
              ? "progress"
              : "attention",
      },
      {
        id: "input",
        label: "Input",
        value:
          health.input.state === "ready"
            ? "Ready"
            : health.input.state === "uncertain"
              ? "Needs review"
              : "Blocked",
        detail:
          health.input.state === "ready"
            ? "Relay may send one reviewed device action."
            : health.input.state === "uncertain"
              ? "Review what happened before sending another action."
              : "Relay has stopped device input until the blocker is resolved.",
        tone:
          health.input.state === "ready"
            ? "ready"
            : health.input.state === "uncertain"
              ? "attention"
              : "blocked",
      },
    ],
  };
}

function planeIcon(plane: HealthPlane): IconName {
  if (plane.tone === "ready") return "check";
  if (plane.tone === "progress") return "refresh";
  if (plane.tone === "blocked") return "x";
  return "alert";
}

export function TargetHealthStatus(props: { health: TargetSupervisorHealth }): JSX.Element {
  const model = () => targetHealthStatusModel(props.health);
  return (
    <section
      class="grid gap-1 rounded-lg border border-border-weak-base bg-surface-base p-1.5"
      aria-label="Device capability status"
      data-target-health-status
    >
      <For each={model().planes}>
        {(plane) => (
          <div
            class="flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-caption"
            data-target-health-plane={plane.id}
            data-target-health-tone={plane.tone}
            aria-label={`${plane.label}: ${plane.value}. ${plane.detail}`}
            data-tip={plane.detail}
          >
            <Icon
              name={planeIcon(plane)}
              size={12}
              class={cn(
                "shrink-0",
                plane.tone === "ready" && "text-icon-success-base",
                plane.tone === "progress" &&
                  "text-text-weak ui-refresh-spin motion-reduce:animate-none",
                plane.tone === "attention" && "text-icon-warning-base",
                plane.tone === "blocked" && "text-icon-critical-base",
              )}
            />
            <span class="min-w-14 text-text-weak">{plane.label}</span>
            <strong class="min-w-0 truncate font-medium text-text-strong">{plane.value}</strong>
          </div>
        )}
      </For>
    </section>
  );
}
