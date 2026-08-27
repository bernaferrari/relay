import type { RecipeStep } from "@relay/protocol";

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function stepErr(index: number, why: string): Error {
  return new Error(`step ${index}: ${why}`);
}

export function parseCampaignCheck(
  raw: Record<string, unknown>,
  index: number,
): RecipeStep["check"] | undefined {
  if (raw.check !== undefined) {
    if (!isObject(raw.check)) throw stepErr(index, "check must be an object");
    if (!isString(raw.check.id) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(raw.check.id)) {
      throw stepErr(index, "check.id must use letters, numbers, hyphens, and underscores only");
    }
    if (
      !isString(raw.check.title) ||
      !raw.check.title.trim() ||
      raw.check.title.trim().length > 160
    ) {
      throw stepErr(index, "check.title must be a non-empty string of at most 160 characters");
    }
    if (raw.optional === true) {
      throw stepErr(index, "check and optional cannot be combined");
    }
    let recovery: NonNullable<RecipeStep["check"]>["recovery"];
    if (raw.check.recovery !== undefined) {
      if (!isObject(raw.check.recovery)) {
        throw stepErr(index, "check.recovery must be an object");
      }
      if (
        !isString(raw.check.recovery.groupId) ||
        !raw.check.recovery.groupId.trim() ||
        raw.check.recovery.groupId.trim().length > 256
      ) {
        throw stepErr(
          index,
          "check.recovery.groupId must be a non-empty string of at most 256 characters",
        );
      }
      if (
        !isString(raw.check.recovery.recipeId) ||
        !raw.check.recovery.recipeId.trim() ||
        raw.check.recovery.recipeId.trim().length > 512
      ) {
        throw stepErr(
          index,
          "check.recovery.recipeId must be a non-empty string of at most 512 characters",
        );
      }
      if (
        raw.check.recovery.transitionId !== undefined &&
        (!isString(raw.check.recovery.transitionId) ||
          !raw.check.recovery.transitionId.trim() ||
          raw.check.recovery.transitionId.trim().length > 256)
      ) {
        throw stepErr(
          index,
          "check.recovery.transitionId must be a non-empty string of at most 256 characters",
        );
      }
      if (raw.check.recovery.mode !== undefined && raw.check.recovery.mode !== "warm-transition") {
        throw stepErr(index, 'check.recovery.mode must be "warm-transition"');
      }
      if (
        raw.check.recovery.coldRecipeId !== undefined &&
        (!isString(raw.check.recovery.coldRecipeId) ||
          !raw.check.recovery.coldRecipeId.trim() ||
          raw.check.recovery.coldRecipeId.trim().length > 512)
      ) {
        throw stepErr(
          index,
          "check.recovery.coldRecipeId must be a non-empty string of at most 512 characters",
        );
      }
      recovery = {
        groupId: raw.check.recovery.groupId.trim(),
        recipeId: raw.check.recovery.recipeId.trim(),
        ...(isString(raw.check.recovery.transitionId) && raw.check.recovery.transitionId.trim()
          ? { transitionId: raw.check.recovery.transitionId.trim() }
          : {}),
        ...(raw.check.recovery.mode === "warm-transition"
          ? { mode: "warm-transition" as const }
          : {}),
        ...(isString(raw.check.recovery.coldRecipeId)
          ? { coldRecipeId: raw.check.recovery.coldRecipeId.trim() }
          : {}),
      };
    }
    let transitionDependencies:
      | NonNullable<NonNullable<RecipeStep["check"]>["transitionDependencies"]>
      | undefined;
    if (raw.check.transitionDependencies !== undefined) {
      if (!Array.isArray(raw.check.transitionDependencies)) {
        throw stepErr(index, "check.transitionDependencies must be an array");
      }
      transitionDependencies = raw.check.transitionDependencies.map((value, dependencyIndex) => {
        if (!isObject(value)) {
          throw stepErr(
            index,
            `check.transitionDependencies[${dependencyIndex}] must be an object`,
          );
        }
        if (!isString(value.connectionId) || !value.connectionId.trim()) {
          throw stepErr(
            index,
            `check.transitionDependencies[${dependencyIndex}].connectionId is required`,
          );
        }
        if (!isString(value.originScreenId) || !value.originScreenId.trim()) {
          throw stepErr(
            index,
            `check.transitionDependencies[${dependencyIndex}].originScreenId is required`,
          );
        }
        if (!isObject(value.destination)) {
          throw stepErr(
            index,
            `check.transitionDependencies[${dependencyIndex}].destination is required`,
          );
        }
        const destination = value.destination;
        if (destination.kind !== "end" && destination.kind !== "screen") {
          throw stepErr(
            index,
            `check.transitionDependencies[${dependencyIndex}].destination is invalid`,
          );
        }
        const destinationScreenId = isString(destination.screenId)
          ? destination.screenId.trim()
          : undefined;
        if (destination.kind === "screen" && !destinationScreenId) {
          throw stepErr(
            index,
            `check.transitionDependencies[${dependencyIndex}].destination.screenId is required`,
          );
        }
        if (
          value.expectedApp !== undefined &&
          (!isString(value.expectedApp) || !value.expectedApp.trim())
        ) {
          throw stepErr(
            index,
            `check.transitionDependencies[${dependencyIndex}].expectedApp must be a non-empty string`,
          );
        }
        return {
          connectionId: value.connectionId.trim(),
          originScreenId: value.originScreenId.trim(),
          destination:
            destination.kind === "screen"
              ? { kind: "screen" as const, screenId: destinationScreenId! }
              : { kind: "end" as const },
          ...(isString(value.expectedApp) ? { expectedApp: value.expectedApp.trim() } : {}),
        };
      });
    }
    let warmSourceScreenId: string | undefined;
    if (raw.check.warmSourceScreenId !== undefined) {
      if (
        !isString(raw.check.warmSourceScreenId) ||
        !raw.check.warmSourceScreenId.trim() ||
        raw.check.warmSourceScreenId.trim().length > 96
      ) {
        throw stepErr(
          index,
          "check.warmSourceScreenId must be a non-empty string of at most 96 characters",
        );
      }
      warmSourceScreenId = raw.check.warmSourceScreenId.trim();
    }
    let cleanup: NonNullable<RecipeStep["check"]>["cleanup"];
    if (raw.check.cleanup !== undefined) {
      if (!isObject(raw.check.cleanup)) {
        throw stepErr(index, "check.cleanup must be an object");
      }
      if (
        !isString(raw.check.cleanup.recipeId) ||
        !raw.check.cleanup.recipeId.trim() ||
        raw.check.cleanup.recipeId.trim().length > 512
      ) {
        throw stepErr(
          index,
          "check.cleanup.recipeId must be a non-empty string of at most 512 characters",
        );
      }
      if (
        !isString(raw.check.cleanup.terminalScreenId) ||
        !raw.check.cleanup.terminalScreenId.trim() ||
        raw.check.cleanup.terminalScreenId.trim().length > 96
      ) {
        throw stepErr(
          index,
          "check.cleanup.terminalScreenId must be a non-empty string of at most 96 characters",
        );
      }
      if (
        raw.check.cleanup.onCancel !== "run-if-controllable" &&
        raw.check.cleanup.onCancel !== "skip"
      ) {
        throw stepErr(index, 'check.cleanup.onCancel must be "run-if-controllable" or "skip"');
      }
      let bindings: Record<string, string> | undefined;
      if (raw.check.cleanup.bindings !== undefined) {
        if (!isObject(raw.check.cleanup.bindings)) {
          throw stepErr(index, "check.cleanup.bindings must be an object");
        }
        bindings = {};
        for (const [name, value] of Object.entries(raw.check.cleanup.bindings)) {
          if (!PARAMETER_NAME.test(name) || !isString(value)) {
            throw stepErr(index, "check.cleanup.bindings must map parameter names to strings");
          }
          bindings[name] = value;
        }
      }
      cleanup = {
        recipeId: raw.check.cleanup.recipeId.trim(),
        ...(bindings ? { bindings } : {}),
        terminalScreenId: raw.check.cleanup.terminalScreenId.trim(),
        onCancel: raw.check.cleanup.onCancel,
      };
    }
    return {
      id: raw.check.id,
      title: raw.check.title.trim(),
      ...(warmSourceScreenId ? { warmSourceScreenId } : {}),
      ...(transitionDependencies ? { transitionDependencies } : {}),
      ...(recovery ? { recovery } : {}),
      ...(cleanup ? { cleanup } : {}),
    };
  }
  return undefined;
}

const EVIDENCE_SURFACES = ["ordinary", "modal", "preview", "confirmation", "dead-end"] as const;

export function parseEvidenceSurface(
  value: unknown,
  index: number,
  field: string,
): (typeof EVIDENCE_SURFACES)[number] | undefined {
  if (value === undefined) return undefined;
  if (!EVIDENCE_SURFACES.includes(String(value) as (typeof EVIDENCE_SURFACES)[number])) {
    throw stepErr(index, `${field} is unsupported`);
  }
  return value as (typeof EVIDENCE_SURFACES)[number];
}

export function parseExpectScreenCampaignFields(
  raw: Record<string, unknown>,
  index: number,
): Pick<
  Extract<RecipeStep, { kind: "expect-screen" }>,
  "returnRequirement" | "repairCheckpoint" | "evidenceSurface" | "destinationSurvey"
> {
  const evidenceSurface = parseEvidenceSurface(
    raw.evidenceSurface,
    index,
    "expect-screen.evidenceSurface",
  );
  let returnRequirement: Extract<RecipeStep, { kind: "expect-screen" }>["returnRequirement"];
  if (raw.returnRequirement !== undefined) {
    if (!isObject(raw.returnRequirement)) {
      throw stepErr(index, "expect-screen.returnRequirement must be an object");
    }
    const requirement = raw.returnRequirement;
    if (
      !isString(requirement.connectionId) ||
      !requirement.connectionId.trim() ||
      !isString(requirement.fromScreenId) ||
      !requirement.fromScreenId.trim() ||
      !isString(requirement.destinationScreenId) ||
      !requirement.destinationScreenId.trim()
    ) {
      throw stepErr(index, "expect-screen.returnRequirement requires connection and endpoint ids");
    }
    returnRequirement = {
      connectionId: requirement.connectionId.trim(),
      fromScreenId: requirement.fromScreenId.trim(),
      destinationScreenId: requirement.destinationScreenId.trim(),
    };
  }
  let repairCheckpoint: Extract<RecipeStep, { kind: "expect-screen" }>["repairCheckpoint"];
  if (raw.repairCheckpoint !== undefined) {
    if (
      !isObject(raw.repairCheckpoint) ||
      !isString(raw.repairCheckpoint.sourceRunId) ||
      !raw.repairCheckpoint.sourceRunId.trim() ||
      !isString(raw.repairCheckpoint.sourceCheckId) ||
      !raw.repairCheckpoint.sourceCheckId.trim() ||
      !isString(raw.repairCheckpoint.sourceInputDigest) ||
      !raw.repairCheckpoint.sourceInputDigest.trim() ||
      (raw.repairCheckpoint.transitionId !== undefined &&
        (!isString(raw.repairCheckpoint.transitionId) || !raw.repairCheckpoint.transitionId.trim()))
    ) {
      throw stepErr(
        index,
        "expect-screen.repairCheckpoint requires source run, check, and input digest",
      );
    }
    repairCheckpoint = {
      sourceRunId: raw.repairCheckpoint.sourceRunId.trim(),
      sourceCheckId: raw.repairCheckpoint.sourceCheckId.trim(),
      sourceInputDigest: raw.repairCheckpoint.sourceInputDigest.trim(),
      ...(isString(raw.repairCheckpoint.transitionId)
        ? { transitionId: raw.repairCheckpoint.transitionId.trim() }
        : {}),
    };
  }
  let destinationSurvey: Extract<RecipeStep, { kind: "expect-screen" }>["destinationSurvey"];
  if (raw.destinationSurvey !== undefined) {
    if (
      !isObject(raw.destinationSurvey) ||
      !isNumber(raw.destinationSurvey.maxScrolls) ||
      !Number.isInteger(raw.destinationSurvey.maxScrolls) ||
      raw.destinationSurvey.maxScrolls < 1 ||
      raw.destinationSurvey.maxScrolls > 12
    ) {
      throw stepErr(
        index,
        "expect-screen.destinationSurvey.maxScrolls must be an integer from 1 to 12",
      );
    }
    destinationSurvey = { maxScrolls: raw.destinationSurvey.maxScrolls };
  }
  return {
    ...(returnRequirement ? { returnRequirement } : {}),
    ...(repairCheckpoint ? { repairCheckpoint } : {}),
    ...(evidenceSurface ? { evidenceSurface } : {}),
    ...(destinationSurvey ? { destinationSurvey } : {}),
  };
}

export function parseTourStops(
  value: unknown,
  includeCapture: boolean,
  index: number,
): NonNullable<Extract<RecipeStep, { kind: "tour" }>["fallbackStops"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as {
      label?: unknown;
      identifier?: unknown;
      point?: { x?: unknown; y?: unknown };
      capture?: unknown;
      optional?: unknown;
      evidenceSurface?: unknown;
    };
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) return [];
    const evidenceSurface = includeCapture
      ? parseEvidenceSurface(row.evidenceSurface, index, "tour.fallbackStops.evidenceSurface")
      : undefined;
    const identifier = typeof row.identifier === "string" ? row.identifier.trim() : "";
    const point =
      row.point && isNumber(row.point.x) && isNumber(row.point.y)
        ? { x: row.point.x, y: row.point.y }
        : undefined;
    return [
      {
        label,
        ...(identifier ? { identifier } : {}),
        ...(point ? { point } : {}),
        ...(includeCapture && row.capture === true ? { capture: true } : {}),
        ...(includeCapture && row.optional === true ? { optional: true } : {}),
        ...(evidenceSurface ? { evidenceSurface } : {}),
      },
    ];
  });
}
