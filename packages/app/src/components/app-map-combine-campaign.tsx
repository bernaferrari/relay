import { Show } from "solid-js";
import type { CombineCampaign } from "@relay/protocol";
import { Button } from "@relay/ui/button";

export function AppMapCombineCampaign(props: {
  campaign: CombineCampaign;
  reviewed: boolean;
  busy: boolean;
  onReviewed: (value: boolean) => void;
  onOpenPilot: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const count = (status: CombineCampaign["cases"][number]["status"]) =>
    props.campaign.cases.filter((item) => item.status === status).length;
  const pending = () => count("pending");
  const problems = () => count("failed") + count("blocked");
  return (
    <section class="rounded-xl border border-[var(--border-base)] bg-[var(--surface-raised-base)] p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="m-0 text-caption font-semibold text-[var(--text-strong)]">
            {props.campaign.status === "pilot-running"
              ? "Pilot running"
              : props.campaign.status === "ready-to-resume"
                ? "Pilot passed"
                : props.campaign.status === "needs-review"
                  ? "Pilot needs review"
                  : props.campaign.status === "running"
                    ? "Coverage running"
                    : props.campaign.status === "cancelled"
                      ? "Campaign cancelled"
                      : props.campaign.status === "completed"
                        ? "Campaign complete"
                        : "Campaign complete with problems"}
          </p>
          <p class="mb-0 mt-1 text-micro text-[var(--text-weak)]">
            {count("passed")} passed · {pending()} untouched · {problems()} problems · revision{" "}
            {props.campaign.latestRevision}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={props.onOpenPilot}>
            View pilot evidence
          </Button>
          <Show when={props.campaign.status === "ready-to-resume"}>
            <Button variant="primary" size="sm" disabled={props.busy} onClick={props.onResume}>
              Run remaining {pending()}
            </Button>
          </Show>
          <Show when={props.campaign.status === "needs-review"}>
            <p class="m-0 mb-2 w-full text-micro/[1.45] text-[var(--text-weak)]">
              The first language ran as a pilot. Review its screenshots below — if they look
              right, confirm and the rest will run.
            </p>
            <label class="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-micro">
              <input
                type="checkbox"
                checked={props.reviewed}
                onChange={(event) => props.onReviewed(event.currentTarget.checked)}
              />
              Reviewed or repaired
            </label>
            <Button
              variant="primary"
              size="sm"
              disabled={props.busy || !props.reviewed}
              onClick={props.onResume}
            >
              Resume untouched {pending()}
            </Button>
          </Show>
          <Show
            when={props.campaign.status === "pilot-running" || props.campaign.status === "running"}
          >
            <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onCancel}>
              Stop campaign
            </Button>
          </Show>
        </div>
      </div>
    </section>
  );
}
