import type {
  BrowserDeviceFrame,
  BrowserDeviceInput,
  OperationInput,
  OperationOutput,
} from "@relay/protocol";
import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";

export type BrowserInspection = OperationOutput<"target.browser-device.inspect"> & {
  frame: BrowserDeviceFrame;
};

/** One browser interaction loop over the canonical supervised operations.
 * Every action returns fresh pixels and semantics. Failed mutations are never
 * replayed automatically; callers can inspect again to recover stale input. */
export function createBrowserWorkflow(client: RelayInvokeClient, targetId: string) {
  const operations = createRelayOperationPort(client);
  async function inspect(): Promise<BrowserInspection> {
    for (let attempt = 0; ; attempt++) {
      const { frame } = await operations.invoke("target.browser-device.frame", { targetId });
      try {
        const semantics = await operations.invoke("target.browser-device.inspect", {
          targetId,
          sessionId: frame.sessionId,
          pageId: frame.pageId,
          expectedSequence: frame.sequence,
        });
        return { ...semantics, frame };
      } catch (error) {
        const code =
          error && typeof error === "object" && "body" in error
            ? (error.body as { code?: string } | undefined)?.code
            : undefined;
        if (code !== "BROWSER_STALE_INPUT" || attempt >= 2) throw error;
      }
    }
  }
  async function act(inspection: BrowserInspection, action: BrowserDeviceInput) {
    if (
      action.sessionId !== inspection.frame.sessionId ||
      action.pageId !== inspection.frame.pageId ||
      action.expectedSequence !== inspection.frame.sequence
    ) {
      throw new Error("Browser action must refer to the inspection being used.");
    }
    await operations.invoke("target.browser-device.control", { targetId, input: action });
    try {
      return await inspect();
    } catch (cause) {
      throw new Error(
        "Browser action completed, but the next inspection failed. Inspect again; do not repeat the action.",
        { cause },
      );
    }
  }
  function identity(inspection: BrowserInspection) {
    return {
      sessionId: inspection.frame.sessionId,
      pageId: inspection.frame.pageId,
      expectedSequence: inspection.frame.sequence,
    };
  }
  return {
    async open(options: Omit<OperationInput<"target.browser-device.open">, "targetId"> = {}) {
      await operations.invoke("target.browser-device.open", { ...options, targetId });
      return inspect();
    },
    inspect,
    act,
    async navigate(url: string) {
      const current = await inspect();
      return act(current, { ...identity(current), kind: "navigate", url });
    },
    async click(current: BrowserInspection, candidateId: string) {
      const candidate = current.overlay.candidates.find(
        (candidate) => candidate.id === candidateId,
      );
      if (!candidate?.enabled)
        throw new Error("Choose an enabled control from the current inspection.");
      return act(current, {
        ...identity(current),
        kind: "click",
        x: candidate.rect.x + candidate.rect.width / 2,
        y: candidate.rect.y + candidate.rect.height / 2,
      });
    },
    async capture() {
      return operations.invoke("target.observation.capture", { serial: targetId });
    },
  };
}
