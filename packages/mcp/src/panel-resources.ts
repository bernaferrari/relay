import {
  getUiCapability,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { readFile } from "node:fs/promises";
import * as z from "zod/v4";
import type { OperationInvoker } from "./server.js";
import { readRelayPanel } from "./panel-state.js";

export const relayPanelToolName = "relay_panel";
export const relayPanelResourceUri = "ui://relay/review";
export const relayPanelMetadata = {
  ui: { resourceUri: relayPanelResourceUri },
  "ui/resourceUri": relayPanelResourceUri,
  "openai/ui": { entrypoints: [{ type: "thread" }] },
};
const resourceMetadata = {
  ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, prefersBorder: false },
  "openai/ui": { preferredDisplayMode: "fullscreen", availableDisplayModes: ["fullscreen"] },
};

/** One read-only tool also works without Apps; the host must negotiate a view. */
export function registerRelayPanel(
  server: McpServer,
  invoker: OperationInvoker,
  scope: { projectId: string },
) {
  const tool = server.registerTool(
    relayPanelToolName,
    {
      title: "Tests and results",
      description:
        "Inspect saved Relay Apps, Tests, recent Runs and one retained screenshot. Read-only; never starts a Run, captures the current device, or records a review decision. Hosts without MCP Apps receive the same bounded state as text.",
      inputSchema: z
        .object({
          appMapId: z.string().min(1).max(240).optional(),
          runId: z.string().min(1).max(240).optional(),
          frameIndex: z.number().int().min(0).max(499).optional(),
        })
        .strict()
        .superRefine((value, ctx) => {
          if (value.frameIndex !== undefined && !value.runId)
            ctx.addIssue({ code: "custom", message: "frameIndex requires runId" });
        }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input, context) => {
      const result = await readRelayPanel(invoker, scope, input, context.mcpReq.signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result.state) }],
        structuredContent: result.state,
        ...(result.frame ? { _meta: { "relay/frame": result.frame } } : {}),
      };
    },
  );
  const previous = server.server.oninitialized;
  server.server.oninitialized = () => {
    previous?.();
    if (
      !getUiCapability(server.server.getClientCapabilities())?.mimeTypes?.includes(
        RESOURCE_MIME_TYPE,
      )
    )
      return;
    tool.update({ _meta: relayPanelMetadata });
    registerAppResource(
      server,
      "relay-review",
      relayPanelResourceUri,
      { description: "Read-only Relay Tests and results", _meta: resourceMetadata },
      async () => ({
        contents: [
          {
            uri: relayPanelResourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: await readFile(new URL("../dist/relay-panel.html", import.meta.url), "utf8"),
            _meta: resourceMetadata,
          },
        ],
      }),
    );
  };
}
