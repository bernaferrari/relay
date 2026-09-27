import type { AuthoringTarget } from "@relay/protocol";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";

export function createFixtureLiveTarget(target: AuthoringTarget, now: number): LiveTargetSession {
  const snapshot = {
    status: "streaming" as const,
    target,
    lastFrameAt: now,
  };
  return {
    snapshot: () => snapshot,
    subscribe(listener: (value: LiveTargetSnapshot) => void) {
      listener(snapshot);
      return () => undefined;
    },
    mount: (canvas: HTMLCanvasElement) => {
      canvas.width = 768;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#f5f6f8";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.fillRect(92, 46, 584, 420);
        context.fillStyle = "#171719";
        context.font = "600 28px system-ui";
        context.fillText("Checkout", 132, 104);
        context.fillStyle = "#62636a";
        context.font = "18px system-ui";
        context.fillText("Order summary", 132, 150);
        context.fillStyle = "#e5e7eb";
        context.fillRect(132, 184, 504, 2);
        context.fillStyle = "#171719";
        context.font = "600 22px system-ui";
        context.fillText("Total", 132, 240);
        context.fillText("$84.00", 548, 240);
        context.fillStyle = "#171719";
        context.fillRect(132, 322, 504, 64);
        context.fillStyle = "#ffffff";
        context.font = "600 20px system-ui";
        context.fillText("Place order", 330, 362);
      }
      return () => undefined;
    },
    input: async () => undefined,
    close: () => undefined,
  };
}
