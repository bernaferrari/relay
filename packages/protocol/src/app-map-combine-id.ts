import type { AppMapCapturePolicy, AppMapVariable } from "./app-map.js";

/** Do not rename; existing Combine ids use this prefix. */
export function combineIdFor(variableIds: readonly string[], testIds: readonly string[]): string {
  const slug = [...variableIds, "to", ...testIds]
    .join("-")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `matrix-${slug || "run"}`;
}

/** Primary capture lenses. Raw capture-policy names are also accepted. */
export type CombineLensName = "visual" | "smoke";
export type CombineLensInput =
  | CombineLensName
  | Exclude<AppMapCapturePolicy["mode"], "checkpoints">;

const LENS_TO_CAPTURE = {
  visual: "every-screen",
  smoke: "failures-only",
  "every-screen": "every-screen",
  "failures-only": "failures-only",
  "final-screen": "final-screen",
  none: "none",
} as const satisfies Record<CombineLensInput, Exclude<AppMapCapturePolicy["mode"], "checkpoints">>;

export const COMBINE_LENS_INPUTS = Object.keys(LENS_TO_CAPTURE) as CombineLensInput[];

export function isCombineLensInput(value: string): value is CombineLensInput {
  return Object.hasOwn(LENS_TO_CAPTURE, value);
}

export function capturePolicyForLens(lens: CombineLensInput): AppMapCapturePolicy {
  return { mode: LENS_TO_CAPTURE[lens] };
}

export function combineLensName(
  mode: AppMapCapturePolicy["mode"],
): CombineLensName | AppMapCapturePolicy["mode"] {
  if (mode === "every-screen") return "visual";
  if (mode === "failures-only") return "smoke";
  return mode;
}

export function variableCanApply(
  variable: Pick<AppMapVariable, "apply" | "options"> & Partial<Pick<AppMapVariable, "kind">>,
): boolean {
  if (variable.apply.kind === "toggle") return true;
  if (!variable.options.length) return false;
  if (variable.apply.kind === "appLocale") return true;
  if (variable.apply.kind !== "list") return false;
  const opens = Boolean(
    variable.apply.inConnectionId?.trim() ||
      variable.apply.entryPath?.length ||
      variable.apply.pickerPath?.length,
  );
  const returns = Boolean(
    variable.apply.outConnectionId?.trim() || variable.apply.exitPath?.length,
  );
  if (variable.kind === "account" && !opens && !returns) return true;
  return opens && returns;
}
