import type { AppMap, StepTarget } from "@relay/protocol";

export type ObservedTargetOption = {
  key: string;
  label: string;
  context: string;
  target: StepTarget;
};

function targetKey(target: StepTarget): string {
  if (target.identifier) return `identifier:${target.identifier}`;
  if (target.label) return `label:${target.label}`;
  if (target.text) return `text:${target.text}`;
  return "";
}

/**
 * Projects durable, human-readable target choices from reviewed map evidence.
 * The editor never stores this projection: it writes the canonical StepTarget,
 * so future collaboration providers can merge the semantic Test document.
 */
export function observedTargetOptions(map: AppMap): ObservedTargetOption[] {
  const choices = new Map<string, ObservedTargetOption>();
  for (const variant of Object.values(map.screenVariants)) {
    const screen = map.screens[variant.screenId];
    for (const node of variant.observation?.nodes ?? []) {
      const target: StepTarget | undefined = node.identifier
        ? { identifier: node.identifier }
        : node.label
          ? { label: node.label }
          : undefined;
      if (!target) continue;
      const key = targetKey(target);
      if (!key || choices.has(key)) continue;
      const name = node.label || node.identifier || node.role;
      choices.set(key, {
        key,
        label: name,
        context: `${screen?.title ?? "Unknown screen"} · ${node.role}`,
        target,
      });
    }
  }
  return [...choices.values()].sort(
    (left, right) =>
      left.context.localeCompare(right.context) || left.label.localeCompare(right.label),
  );
}

export function selectedTargetKey(
  options: ObservedTargetOption[],
  target: StepTarget | undefined,
): string {
  if (!target) return "";
  const key = targetKey(target);
  return options.some((option) => option.key === key) ? key : "";
}
