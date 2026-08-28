import type { OperationInput, OperationOutput, TargetSupervisorHealth } from "@relay/protocol";
import { createEffect, createSignal, type Accessor } from "solid-js";
import type { HealthState } from "./api-types";

type TargetHealthRunAction = (
  operation: "target.health.get",
  input: OperationInput<"target.health.get">,
) => Promise<OperationOutput<"target.health.get">>;

/**
 * Keeps the selected target's product health projection tied to the canonical
 * supervisor operation. A failed refresh preserves the last observed health;
 * transport failure is not evidence that pixels or device control disappeared.
 */
export function createServerTargetHealthController(input: {
  selectedDevice: Accessor<string | null>;
  serverHealth: Accessor<HealthState>;
  runAction: TargetHealthRunAction;
}) {
  const [targetHealth, setTargetHealth] = createSignal<TargetSupervisorHealth | null>(null);
  const [targetHealthIssue, setTargetHealthIssue] = createSignal("");
  let requestSequence = 0;

  async function refreshTargetHealth(): Promise<void> {
    const serial = input.selectedDevice();
    if (!serial || input.serverHealth() !== "online") return;
    const sequence = ++requestSequence;
    try {
      const result = await input.runAction("target.health.get", { serial });
      if (sequence !== requestSequence || input.selectedDevice() !== serial) return;
      if (result.health.target.id !== serial) throw new Error("Target health identity changed");
      setTargetHealth(result.health);
      setTargetHealthIssue("");
    } catch (error) {
      if (sequence !== requestSequence || input.selectedDevice() !== serial) return;
      setTargetHealthIssue(error instanceof Error ? error.message : String(error));
    }
  }

  createEffect(() => {
    const serial = input.selectedDevice();
    const online = input.serverHealth() === "online";
    requestSequence += 1;
    setTargetHealth(null);
    setTargetHealthIssue("");
    if (serial && online) void refreshTargetHealth();
  });

  return { targetHealth, targetHealthIssue, refreshTargetHealth };
}
