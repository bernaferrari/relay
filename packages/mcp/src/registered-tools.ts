import type { OperationId } from "@relay/protocol";
import { relayEverydayTools } from "./everyday-tools.js";
import { relayOperatorTools } from "./operator-tools.js";
import { relayFullOutcomeTools, relayOutcomeTools } from "./outcome-tools.js";
import { relayPanelToolName } from "./panel-resources.js";
import {
  relayMcpToolsForProfile,
  relayQaOperationTools,
  type RelayMcpProfile,
  type RelayMcpToolDescriptor,
} from "./tools.js";

const names = (list: readonly { readonly name: string }[]) => list.map(({ name }) => name);

/** Tool names in the order createMcpServer registers them. Each profile is
 * the previous one plus more: qa ⊂ device ⊂ full. */
export function relayRegisteredToolNames(
  profile: RelayMcpProfile,
  tools: readonly RelayMcpToolDescriptor[] = relayMcpToolsForProfile(profile),
): readonly string[] {
  const qa = [...names(relayEverydayTools), ...names(relayQaOperationTools), relayPanelToolName];
  if (profile === "qa") return qa;
  const device = [...qa, ...names(relayOperatorTools), ...names(relayOutcomeTools)];
  if (profile === "device") return device;
  return [...device, ...names(relayFullOutcomeTools), ...names(tools)];
}

/** Server operations the qa tools call (directly or through the run workflow). */
const qaRequiredOperationIds = [
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.preflight",
  "app-map.list",
  "app-map.get",
  "app-map.create",
  "app-map.test.compile",
  "app-map.test.run",
  "test.create-from-goal",
  "test.apply-yaml",
  "test.yaml.get",
  "workflow.create",
  "workflow.get",
  "workflow.transition",
  "lease.list",
  "lease.create",
  "job.get",
  "run.get",
  "run.list",
  "run.verdict.get",
  "run.evidence.get",
  "run.repair.list",
  "run.trace-pack.get",
  "run.panel-manifest.get",
] as const satisfies readonly OperationId[];

/** Plus what live control, recording and repeats call. */
const deviceRequiredOperationIds = [
  ...qaRequiredOperationIds,
  "target.screenshot.capture",
  "target.observation.capture",
  "target.interact",
  "target.app.launch",
  "target.recover",
  "lane.list",
  "job.list",
  "job.cancel",
  "job.combine.campaign.repeat.active",
  "job.combine.campaign.get",
  "job.combine.campaign.resume",
  "job.combine.campaign.cancel",
  "run.repair.propose",
] as const satisfies readonly OperationId[];

/** Operations a server must expose for the named qa or device tools to work. */
export function relayRequiredOperationIds(
  profile: Exclude<RelayMcpProfile, "full">,
): readonly OperationId[] {
  return profile === "qa" ? qaRequiredOperationIds : deviceRequiredOperationIds;
}
