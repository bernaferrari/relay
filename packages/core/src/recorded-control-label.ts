import type {
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  StepTarget,
} from "@relay/protocol";

type CapturedControl = {
  identifier?: string;
  bundleId?: string;
  role?: string;
  type?: string;
  hittable?: boolean;
  enabled?: boolean;
  visibleToUser?: boolean;
};

/** Reviewed control aliases are presentation only. A resource ID without its
 * owning capture is insufficient: unrelated apps may use the same identifier. */
export function recordedControlDisplayName(
  target: StepTarget,
  nodes: readonly CapturedControl[],
  platform?: string,
): string | undefined {
  if (target.identifier !== "input_send_button" || target.label || target.text) return undefined;
  const controls = nodes.filter((node) => node.identifier === target.identifier);
  if (controls.length !== 1) return undefined;
  const control = controls[0]!;
  if (control.enabled === false || control.visibleToUser === false) return undefined;
  const role = (control.role ?? control.type ?? "").toLowerCase().split(".").at(-1);
  if (control.hittable !== true && role !== "button") return undefined;
  if (control.bundleId) return control.bundleId === "ai.x.grok" ? "Send message" : undefined;
  // Saved normalized Android observations retain resource ownership, while
  // deliberately dropping raw package/hierarchy fields. Do not infer ownership
  // from the App Map name or from the button's unqualified identifier.
  if (
    platform === "android" &&
    nodes.some((node) => node.identifier === "ai.x.grok:id/action_bar_root")
  )
    return "Send message";
  return undefined;
}

export function recordedTapDisplayTitle(
  title: string,
  target: StepTarget,
  nodes: readonly CapturedControl[],
  platform?: string,
): string {
  const identifier = target.identifier;
  if (!identifier || (title !== `Tap “${identifier}”` && title !== `Tap "${identifier}"`))
    return title;
  const name = recordedControlDisplayName(target, nodes, platform);
  return name ? `Tap “${name}”` : title;
}

/** Project a saved instruction without editing authored intent, bindings, or
 * frozen evidence. Multiple actions keep their authored summary unchanged. */
export function testInstructionDisplayTitle(map: AppMap, step: AppMapScenarioTestStep): string {
  if (
    step.kind !== "instruction" ||
    step.binding?.status !== "resolved" ||
    step.binding.kind !== "connections" ||
    step.binding.connectionIds.length !== 1
  )
    return step.intent;
  const connection = map.connections[step.binding.connectionIds[0]!];
  if (!connection || connection.actions.length !== 1) return step.intent;
  const action = connection.actions[0]!;
  const tap = action.kind === "recorded" && action.steps.length === 1 ? action.steps[0] : action;
  if (tap?.kind !== "tap" || !tap.target) return step.intent;
  for (const id of map.screens[connection.fromScreenId]?.variantIds ?? []) {
    const variant = map.screenVariants[id];
    if (!variant?.observation || variant.refreshCapture) continue;
    const title = recordedTapDisplayTitle(
      step.intent,
      tap.target,
      variant.observation.nodes,
      variant.targetProfile.platform,
    );
    if (title !== step.intent) return title;
  }
  return step.intent;
}

export function testInstructionDisplayTitles(
  map: AppMap,
  test: AppMapScenarioTest,
): Record<string, string> {
  const titles: Record<string, string> = {};
  function visit(steps: readonly AppMapScenarioTestStep[]) {
    for (const step of steps) {
      const title = testInstructionDisplayTitle(map, step);
      if (title !== step.intent) titles[step.id] = title;
      if (step.kind === "decision") {
        visit(step.thenSteps);
        visit(step.elseSteps ?? []);
      } else if (step.kind === "loop") visit(step.steps);
    }
  }
  visit(test.steps);
  return titles;
}
