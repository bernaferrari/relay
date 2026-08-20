import { For, Show } from "solid-js";
import type { OfflineTestPreflightReport } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { Icon } from "./icon";
import { groupPreflightFindings } from "../lib/app-map-test-preflight-model";

/** A compact human view of frozen-plan checks. It intentionally contains no
 * execution affordance: the report explains what must be taught or repaired
 * before a device is allowed to act. */
export function AppMapTestPreflight(props: {
  report: OfflineTestPreflightReport;
  open: boolean;
  onToggle: () => void;
}) {
  const blockers = () => props.report.summary.blockers;
  const warnings = () => props.report.summary.warnings;
  const issueCount = () => blockers() + warnings();
  const groups = () => groupPreflightFindings(props.report.findings);
  const summary = () => {
    if (blockers()) {
      return `${blockers()} offline ${blockers() === 1 ? "issue blocks" : "issues block"} device control`;
    }
    if (warnings()) {
      return `${warnings()} offline ${warnings() === 1 ? "check needs" : "checks need"} review`;
    }
    return "Offline check passed";
  };

  return (
    <section
      id="test-offline-preflight"
      tabindex={-1}
      class={`rounded-md border p-3 focus:outline-none ${
        blockers()
          ? "border-border-warning-base bg-surface-warning-weak"
          : warnings()
            ? "border-border-weak-base bg-surface-base"
            : "border-border-success-base bg-surface-success-weak"
      }`}
      aria-labelledby="test-offline-preflight-title"
    >
      <div class="flex items-start gap-2">
        <Icon
          name={blockers() ? "alert" : "check"}
          size={16}
          class={
            blockers()
              ? "mt-0.5 shrink-0 text-icon-warning-base"
              : "mt-0.5 shrink-0 text-icon-success-base"
          }
        />
        <div class="min-w-0 flex-1">
          <p
            id="test-offline-preflight-title"
            class="m-0 text-caption font-medium text-text-strong"
          >
            {summary()}
          </p>
          <p class="mt-0.5 mb-0 max-w-[65ch] text-caption/[1.45] text-text-base">
            Checked {props.report.summary.checkedSelectors} selectors against frozen evidence. No
            phone was used, and Relay will not invent missing geometry or navigation.
          </p>
        </div>
        <Show when={issueCount() > 0}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            class="shrink-0"
            aria-expanded={props.open}
            aria-controls="test-offline-preflight-findings"
            onClick={props.onToggle}
          >
            {props.open ? "Hide checks" : "Review checks"}
          </Button>
        </Show>
      </div>
      <Show when={props.open && issueCount() > 0}>
        <ul
          id="test-offline-preflight-findings"
          class="mt-3 grid list-none gap-2 border-t border-border-weak-base pt-3 pl-0"
        >
          <For each={groups()}>
            {(group) => (
              <li class="rounded-sm bg-surface-raised-stronger-non-alpha text-caption/[1.4] text-text-base">
                <details>
                  <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 px-2.5 py-2 marker:hidden [&::-webkit-details-marker]:hidden">
                    <Icon name="chevron-right" size={14} class="shrink-0 text-icon-weak" />
                    <span class="min-w-0 flex-1 font-medium text-text-strong">{group.title}</span>
                    <span class="shrink-0 tabular-nums text-text-weak">
                      {group.findings.length}
                    </span>
                  </summary>
                  <div class="border-t border-border-weak-base px-2.5 py-2">
                    <p class="m-0 max-w-[65ch] text-text-base">{group.action}</p>
                    <ul class="mt-2 grid list-none gap-1.5 pl-0">
                      <For each={group.findings}>
                        {(finding) => (
                          <li class="rounded-xs bg-surface-base px-2 py-1.5">
                            <strong class="text-text-strong">
                              {finding.severity === "blocker"
                                ? "Fix before running."
                                : "Review before trusting."}
                            </strong>{" "}
                            {finding.message}
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </details>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
