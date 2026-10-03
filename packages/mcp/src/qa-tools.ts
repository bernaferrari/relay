import type { OperationId } from "@relay/protocol";
import { relayOutcomeTools } from "./outcome-tools.js";
import { relayOperatorTools } from "./operator-tools.js";

/** A selection of existing contracts, not a second QA runtime or dispatcher. */
const outcomeNames = new Set([
  "relay_connect_target",
  "relay_observe_target",
  "relay_record_test",
  "relay_record_action",
  "relay_add_checkpoint",
  "relay_stop_recording",
  "relay_edit_recording",
  "relay_replay_recording",
  "relay_approve_recording",
  "relay_run_test",
  "relay_repeat_test",
  "relay_continue_repeat",
  "relay_inspect_workflow",
  "relay_cancel_run",
  "relay_inspect_failure",
  "relay_propose_repair",
  "relay_export_evidence",
]);
const operatorNames = new Set(["relay_health", "relay_preview", "relay_recover"]);

function selectTools<T extends { readonly name: string }>(
  tools: readonly T[],
  names: ReadonlySet<string>,
): readonly T[] {
  const selected = tools.filter(({ name }) => names.has(name));
  const missing = [...names].filter((name) => !selected.some((tool) => tool.name === name));
  if (missing.length)
    throw new Error(`QA preset is missing existing contracts: ${missing.join(", ")}`);
  return Object.freeze(selected);
}

export const relayQaOutcomeTools = selectTools(relayOutcomeTools, outcomeNames);
export const relayQaOperatorTools = selectTools(relayOperatorTools, operatorNames);

/** Hard dependencies in the existing outcome workflows and selected operators.
 * workflow.transition owns recording edits, replay, approval and durable Run decisions. */
export const relayQaRequiredOperationIds = Object.freeze([
  "system.health.get",
  "target.devices.list",
  "target.list",
  "target.preflight",
  "target.observation.capture",
  "target.interact",
  "target.recover",
  "app-map.list",
  "app-map.get",
  "app-map.create",
  "lease.list",
  "lease.create",
  "workflow.create",
  "workflow.get",
  "workflow.transition",
  "run.get",
  "run.list",
  "run.walkthrough-pack.get",
  "app-map.test.compile",
  "app-map.test.run",
  "job.list",
  "job.get",
  "job.cancel",
  "lane.list",
  "target.browser-auth.list",
  "job.combine.campaign.repeat.active",
  "job.combine.campaign.get",
  "job.combine.campaign.resume",
  "job.combine.campaign.cancel",
  "run.evidence.get",
  "run.repair.list",
  "run.repair.propose",
  "run.trace-pack.get",
] as const satisfies readonly OperationId[]);
