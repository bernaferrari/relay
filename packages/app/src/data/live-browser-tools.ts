import type { RelayClient } from "@relay/client";
import {
  browserPageToolSchema,
  type BrowserDeviceFrame,
  type BrowserPageTool,
} from "@relay/protocol";
import { RecordingInputNotSentError } from "./recording-input-outcome";

/** Manual page tools use the same painted-frame and supervised input contract as taps. */
export function createLiveBrowserTools(
  client: RelayClient,
  targetId: string,
  current: () => { closed: boolean; frame: BrowserDeviceFrame | undefined },
) {
  return async (command: BrowserPageTool) => {
    const { closed, frame } = current();
    if (closed || !frame)
      throw new RecordingInputNotSentError("Wait for the browser preview to connect.");
    const result = await client.invoke("target.browser-device.control", {
      targetId,
      input: {
        ...browserPageToolSchema.parse(command),
        sessionId: frame.sessionId,
        pageId: frame.pageId,
        expectedSequence: frame.sequence,
        interaction: "direct",
      },
    });
    const deadline = Date.now() + 3000;
    while (
      !current().closed &&
      current().frame?.sequence === frame.sequence &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    return result.tools ?? {};
  };
}
