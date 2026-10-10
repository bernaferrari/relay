import { relayEverydayToolsForProfile } from "./everyday-tools.js";
import { relayOperatorTools } from "./operator-tools.js";
import { relayOutcomeTools } from "./outcome-tools.js";
import { relayPanelToolName } from "./panel-resources.js";
import { relayQaOperatorTools, relayQaOutcomeTools } from "./qa-tools.js";
import {
  relayMcpToolsForProfile,
  type RelayMcpProfile,
  type RelayMcpToolDescriptor,
} from "./tools.js";

/** Names in the order createMcpServer registers them. Raw operation profiles
 * list canonical operation ids after their friendly everyday tools. */
export function relayRegisteredToolNames(
  profile: RelayMcpProfile,
  tools: readonly RelayMcpToolDescriptor[] = relayMcpToolsForProfile(profile),
): readonly string[] {
  const everyday = relayEverydayToolsForProfile(profile).map(({ name }) => name);
  if (profile === "qa") {
    return [
      ...everyday,
      relayPanelToolName,
      ...[...relayQaOutcomeTools, ...relayQaOperatorTools, ...tools].map(({ name }) => name),
    ];
  }
  if (profile === "outcome") return [...everyday, ...relayOutcomeTools.map(({ name }) => name)];
  if (profile === "operator") return [...everyday, ...relayOperatorTools.map(({ name }) => name)];
  return [...everyday, ...tools.map(({ operationId }) => operationId)];
}
