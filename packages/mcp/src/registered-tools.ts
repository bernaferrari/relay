import { relayEverydayToolsForProfile } from "./everyday-tools.js";
import { relayOperatorTools } from "./operator-tools.js";
import { relayOutcomeTools } from "./outcome-tools.js";
import { relayPanelToolName } from "./panel-resources.js";
import { proofOutcomeTools } from "./proof-outcome-tools.js";
import { relayQaOperatorTools, relayQaOutcomeTools } from "./qa-tools.js";
import {
  relayMcpToolsForProfile,
  type RelayMcpProfile,
  type RelayMcpToolDescriptor,
} from "./tools.js";

/** Tool names in the order createMcpServer registers them: the everyday loop
 * first, then the profile's friendly tools, then raw operation tools. Every
 * entry is a registered MCP tool name (never a dotted operation id). */
export function relayRegisteredToolNames(
  profile: RelayMcpProfile,
  tools: readonly RelayMcpToolDescriptor[] = relayMcpToolsForProfile(profile),
): readonly string[] {
  const names = (list: readonly { readonly name: string }[]) => list.map(({ name }) => name);
  const everyday = names(relayEverydayToolsForProfile(profile));
  if (profile === "qa") {
    return [
      ...everyday,
      relayPanelToolName,
      ...names(relayQaOutcomeTools),
      ...names(relayQaOperatorTools),
      ...names(tools),
    ];
  }
  if (profile === "outcome") return [...everyday, ...names(relayOutcomeTools)];
  if (profile === "operator") return [...everyday, ...names(relayOperatorTools)];
  return [...everyday, ...(profile === "proof" ? names(proofOutcomeTools) : []), ...names(tools)];
}
