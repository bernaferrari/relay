import type { McpServer } from "@modelcontextprotocol/server";
import { formatRelayTaskGuide, relayTaskGuideCatalog } from "@relay/workflows/task-guides";
import { registerStaticResource, type RelayResourceScope } from "./resource-pagination.js";
import type { RelayMcpProfile, RelayMcpToolDescriptor } from "./tools.js";

/** Every profile can read task guidance without invoking the Relay server. */
export function registerTaskGuideResources(
  server: McpServer,
  scope: RelayResourceScope,
  profile: RelayMcpProfile,
  tools: readonly RelayMcpToolDescriptor[],
): void {
  registerStaticResource(
    server,
    "task-guides",
    "Relay task guides",
    "relay://guides",
    async () => ({
      guides: relayTaskGuideCatalog.map(({ topic, title, summary }) => ({
        topic,
        title,
        summary,
        uri: `relay://guides/${topic}`,
      })),
      guidance:
        "Read the relevant guide before a task. Guidance is bundled with this MCP version and requires no server or model.",
    }),
    scope,
    profile,
    tools,
  );
  for (const guide of relayTaskGuideCatalog) {
    registerStaticResource(
      server,
      `guide-${guide.topic}`,
      guide.title,
      `relay://guides/${guide.topic}`,
      async () => ({
        topic: guide.topic,
        title: guide.title,
        markdown: formatRelayTaskGuide(guide),
      }),
      scope,
      profile,
      tools,
    );
  }
}
