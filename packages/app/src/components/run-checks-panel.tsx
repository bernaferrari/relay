import { Show, createMemo } from "solid-js";
import type { JobInfo } from "../lib/api-types";
import type { CampaignCheckResult } from "../lib/campaign-check-results";
import { CampaignCheckResults } from "./campaign-check-results";
import { EvidenceList } from "./run-evidence-panels";

const EVALUATION_KINDS = new Set([
  "response-completion",
  "conversation-turn",
  "content-assertion",
  "semantic-evaluation",
  "judge-consensus",
  "frozen-inputs",
  "app-build",
]);

export function RunChecksPanel(props: {
  job: JobInfo;
  frameSource: (frame: CampaignCheckResult["frames"][number]) => string;
  onOpenFrame: (index: number) => void;
}) {
  const evaluation = createMemo(() =>
    (props.job.artifacts ?? []).filter((item) => EVALUATION_KINDS.has(item.kind)),
  );
  const hasCampaignChecks = () =>
    Boolean(props.job.checks?.length) ||
    Boolean(props.job.artifacts?.some((item) => item.kind === "campaign-check-result"));
  return (
    <div class="grid gap-4">
      <CampaignCheckResults
        job={props.job}
        frameSource={props.frameSource}
        onOpenFrame={props.onOpenFrame}
      />
      <Show when={evaluation().length > 0 || !hasCampaignChecks()}>
        <EvidenceList
          items={evaluation()}
          empty="No checks on this run. Add a screen or text check when you edit the path, then run again."
        />
      </Show>
    </div>
  );
}
