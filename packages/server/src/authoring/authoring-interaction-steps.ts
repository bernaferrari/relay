import type { AuthoringInteraction, RecipeStep } from "@relay/protocol";

export function executableInteraction(interaction: AuthoringInteraction): RecipeStep[] {
  switch (interaction.kind) {
    case "tap":
      return [
        {
          kind: "tap",
          target: structuredClone(interaction.target),
          ...(interaction.expectedApp ? { expectedApp: interaction.expectedApp } : {}),
        },
      ];
    case "type":
      return [
        {
          kind: "type",
          text: interaction.text,
          ...(interaction.target ? { target: structuredClone(interaction.target) } : {}),
          ...(interaction.mode ? { mode: interaction.mode } : {}),
        },
      ];
    case "clipboard":
      return [
        {
          kind: "clipboard",
          action: interaction.action,
          ...(interaction.text !== undefined ? { text: interaction.text } : {}),
          ...(interaction.target ? { target: structuredClone(interaction.target) } : {}),
          ...(interaction.expect !== undefined ? { expect: interaction.expect } : {}),
          ...(interaction.match ? { match: interaction.match } : {}),
        },
      ];
    case "app":
      return [
        {
          kind: "app",
          action: interaction.action,
          ...(interaction.app !== undefined ? { app: interaction.app } : {}),
          ...(interaction.url !== undefined ? { url: interaction.url } : {}),
          ...(interaction.relaunch !== undefined ? { relaunch: interaction.relaunch } : {}),
          ...(interaction.artifact !== undefined ? { artifact: interaction.artifact } : {}),
          ...(interaction.as !== undefined ? { as: interaction.as } : {}),
          ...(interaction.version !== undefined ? { version: interaction.version } : {}),
          ...(interaction.versionMatch ? { versionMatch: interaction.versionMatch } : {}),
        },
      ];
    case "device":
      return [{ kind: "device", action: interaction.action }];
    case "rotate":
      return [{ kind: "rotate", orientation: interaction.orientation }];
    case "swipe":
      return [
        {
          kind: "swipe",
          from: { ...interaction.from },
          to: { ...interaction.to },
          ...(interaction.durationMs !== undefined ? { durationMs: interaction.durationMs } : {}),
        },
      ];
    case "key":
      return [{ kind: "key", key: interaction.key }];
    case "wait":
      return interaction.ms > 0 ? [{ kind: "sleep", ms: interaction.ms }] : [];
    case "observe":
    case "screenshot":
    case "reusable":
      return [];
    case "steps":
      return structuredClone(interaction.steps);
  }
}
