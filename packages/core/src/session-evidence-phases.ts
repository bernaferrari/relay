import type { RecipeStep } from "./recipes.js";

export function automaticEvidencePhases(step: RecipeStep): readonly ("before" | "after")[] {
  switch (step.kind) {
    // These steps already produce their own evidence or only orchestrate
    // nested steps. Capturing two additional device states adds latency and
    // duplicate frames without improving diagnosis.
    case "sleep":
    case "screenshot":
    case "capture-surface":
    case "tour":
    case "logs":
    case "network":
    case "script":
    case "flow":
    case "module":
    case "repeat":
    case "branch":
      return [];
    case "app":
      // A matrix's locale/open wrapper is followed by an explicit mapped
      // screen assertion and screenshot. Capturing both sides here duplicates
      // that evidence, costs two full tree+raster reads per world, and makes a
      // simple one-cold-start traversal look like repeated app restarts. Keep
      // the command attempt and its failure frame; mapped destinations remain
      // the canonical visual evidence.
      if (step.action === "open" || step.action === "set-locale") return [];
      return ["after"];
    case "device":
      // Keyboard dismissal is setup noise. The next mapped assertion captures
      // the settled application surface; failures still receive a frame.
      if (step.action === "keyboard-dismiss") return [];
      return ["after"];
    // Assertions need resulting state; interactions retain both sides.
    case "expect-screen":
      return step.id?.startsWith("relay-source-") || step.id?.endsWith(":warm") ? [] : ["after"];
    case "expect":
    case "assert-content":
    case "extract":
    case "evaluate-semantic":
    case "wait-for":
    case "wait-response":
    case "pause":
    case "review":
      return ["after"];
    default:
      return ["before", "after"];
  }
}
