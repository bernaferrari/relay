import type {
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  AppMapTestResolvedBinding,
  RecipeStep,
} from "@relay/protocol";

export type ValidationDraft =
  | { kind: "capture"; name: string; lookFor: string }
  | { kind: "screen"; screenId: string }
  | {
      kind: "content";
      input: string;
      expected: string;
      match: "exact" | "equals" | "contains" | "not-contains" | "number-equals" | "field";
      field?: string;
    }
  | { kind: "visual"; criteria: string; region: string; requireAgreement: boolean }
  | { kind: "semantic"; input: string; criteria: string; requireAgreement: boolean }
  | {
      kind: "wait-for";
      label: string;
      condition: "visible" | "gone";
      seconds: string;
      source?: Extract<RecipeStep, { kind: "expect" }>;
      assertionSource?: Extract<
        Extract<AppMapTestResolvedBinding, { kind: "assertion" }>["assertion"],
        { kind: "target" }
      >;
    }
  | {
      kind: "wait-response";
      label: string;
      maxMs: string;
      source?: Extract<RecipeStep, { kind: "wait-response" }>;
    }
  | { kind: "extract"; as: string; label: string; role: "assistant" | "user" | "" }
  | { kind: "identity-ignore"; name: string; region: string }
  | { kind: "upload"; file: string; label: string };

function controlLabel(target: {
  label?: string;
  text?: string;
  identifier?: string;
}): string | undefined {
  return target.label ?? target.text ?? target.identifier;
}

function waitCopy(
  target: { label?: string; text?: string; identifier?: string },
  gone: boolean,
): string {
  const label = controlLabel(target);
  const condition = gone ? "gone" : "visible";
  return label ? `Waits until ${label} is ${condition}.` : `Waits until a control is ${condition}.`;
}

export function checkpointBindingCopy(step: AppMapScenarioTestStep): string | undefined {
  if (step.kind !== "validation" || step.binding.status !== "resolved") return undefined;
  if (step.binding.kind === "assertion") {
    const assertion = step.binding.assertion;
    if (assertion.kind === "screen") return "Checks that the expected screen is showing.";
    if (assertion.kind === "target")
      return waitCopy(assertion.target, assertion.condition === "gone");
    if (assertion.kind === "layout") return "Checks that two controls do not overlap.";
    if (assertion.kind === "content")
      return `Checks ${assertion.input} ${assertion.match} ${assertion.expected}.`;
    if (assertion.kind === "visual")
      return "A visual judge will score this screenshot. Disagreement stays Needs review. Do not auto-accept.";
    if (assertion.kind === "semantic") return `A semantic judge will score ${assertion.input}.`;
    return undefined;
  }
  if (step.binding.kind !== "recipe-step") return undefined;
  const recipe = step.binding.step;
  if (recipe.kind === "expect") return waitCopy(recipe.target, recipe.condition === "gone");
  if (recipe.kind === "expect-set") {
    const count = recipe.labels.length;
    return count
      ? `Checks ${count} listed control${count === 1 ? "" : "s"} ${recipe.extras === "allow" ? "and allows extras" : "with no extras"}.`
      : "Checks a listed set of controls.";
  }
  if (recipe.kind === "assert-content") return "Checks extracted text against an expected value.";
  if (recipe.kind === "assert-layout") return "Checks layout against a recorded arrangement.";
  if (recipe.kind === "wait-response") return "Waits for a reply to finish.";
  if (recipe.kind === "extract")
    return recipe.as
      ? `Remembers the reply as ${recipe.as}.`
      : "Remembers the reply for a semantic judge.";
  if (recipe.kind === "identity-ignore")
    return recipe.name
      ? `Ignores ${recipe.name} so only chrome is compared.`
      : "Ignores a rectangle so only chrome is compared.";
  if (recipe.kind === "screenshot") {
    return recipe.review?.mode === "later"
      ? recipe.caption
        ? `Captures “${recipe.caption}” for a person to review later. Does not approve a baseline.`
        : "Captures a screenshot for a person to review later. Does not approve a baseline."
      : recipe.caption
        ? `Captures “${recipe.caption}”.`
        : "Captures a screenshot.";
  }
  if (recipe.kind === "evaluate-visual")
    return "A visual judge will score this screenshot. Disagreement stays Needs review. Do not auto-accept.";
  if (recipe.kind === "evaluate-semantic") return "A semantic judge will score the reply.";
  if (recipe.kind === "upload") {
    return `Browser attaches ${recipe.file || "a workspace file"} through a file input or chooser. Android stages it in Downloads; follow with recorded picker steps and check the attachment. iOS upload is blocked; use a reviewed Files-app handoff. Does not accept a visual baseline.`;
  }
  return undefined;
}

export function stepBindingCopy(step: AppMapScenarioTestStep): string | undefined {
  if (step.binding.status !== "resolved") return undefined;
  if (step.kind === "validation") return undefined;
  if ("kind" in step.binding && step.binding.kind === "connections") {
    const count = step.binding.connectionIds.length;
    return count === 1 ? "Uses one saved path." : `Uses ${count} saved paths.`;
  }
  if ("kind" in step.binding && step.binding.kind === "routine") return "Uses a saved section.";
  return "This step has a saved target.";
}

export function validationDraft(step: AppMapScenarioTestStep): ValidationDraft | undefined {
  if (step.kind !== "validation" || step.binding.status !== "resolved") return undefined;
  if (
    step.binding.kind === "recipe-step" &&
    step.binding.step.kind === "expect" &&
    step.binding.step.target.label
  ) {
    const recipe = step.binding.step;
    return {
      kind: "wait-for",
      label: recipe.target.label!,
      condition: recipe.condition,
      seconds: String((recipe.timeoutMs ?? 8000) / 1000),
      source: structuredClone(recipe),
    };
  }
  if (step.binding.kind === "recipe-step" && step.binding.step.kind === "wait-response") {
    return {
      kind: "wait-response",
      label: controlLabel(step.binding.step.target) ?? step.binding.step.target.ref ?? "",
      maxMs: step.binding.step.maxMs === undefined ? "" : String(step.binding.step.maxMs),
      source: structuredClone(step.binding.step),
    };
  }
  if (step.binding.kind === "recipe-step" && step.binding.step.kind === "extract") {
    return {
      kind: "extract",
      as: step.binding.step.as,
      label: step.binding.step.target.label ?? step.binding.step.target.text ?? "",
      role: step.binding.step.role === "user" ? "user" : "assistant",
    };
  }
  if (step.binding.kind === "recipe-step" && step.binding.step.kind === "identity-ignore") {
    const region = step.binding.step.region;
    return {
      kind: "identity-ignore",
      name: step.binding.step.name ?? "",
      region: `${region.x},${region.y},${region.width},${region.height}`,
    };
  }
  if (step.binding.kind === "recipe-step" && step.binding.step.kind === "upload") {
    return {
      kind: "upload",
      file: step.binding.step.file,
      label: step.binding.step.target?.label ?? "",
    };
  }
  if (
    step.binding.kind === "recipe-step" &&
    step.binding.step.kind === "screenshot" &&
    step.binding.step.review?.mode === "later"
  ) {
    return {
      kind: "capture",
      name: step.binding.step.caption ?? "",
      lookFor: step.binding.step.review.lookFor ?? "",
    };
  }
  if (step.binding.kind !== "assertion") return undefined;
  const assertion = step.binding.assertion;
  if (assertion.kind === "target" && assertion.target.label)
    return {
      kind: "wait-for",
      label: assertion.target.label,
      condition: assertion.condition,
      seconds: String((assertion.timeoutMs ?? 8000) / 1000),
      assertionSource: structuredClone(assertion),
    };
  if (assertion.kind === "screen") return { kind: "screen", screenId: assertion.screenId };
  if (assertion.kind === "content") {
    return {
      kind: "content",
      input: assertion.input,
      expected: assertion.expected,
      match: assertion.match,
    };
  }
  if (assertion.kind === "visual") {
    return {
      kind: "visual",
      criteria: assertion.criteria.join("\n"),
      region: assertion.region
        ? `${assertion.region.x},${assertion.region.y},${assertion.region.width},${assertion.region.height}`
        : "",
      requireAgreement: assertion.requireAgreement === true,
    };
  }
  if (assertion.kind === "semantic") {
    return {
      kind: "semantic",
      input: assertion.input,
      criteria: assertion.criteria.join("\n"),
      requireAgreement: assertion.requireAgreement === true,
    };
  }
  return undefined;
}

export function isValidationDraftReady(draft: ValidationDraft): boolean {
  if (draft.kind === "wait-for")
    return Boolean(draft.label.trim()) && validWaitSeconds(draft.seconds);
  if (draft.kind === "capture") return Boolean(draft.name.trim());
  if (draft.kind === "upload") return Boolean(draft.file.trim());
  if (draft.kind === "screen") return Boolean(draft.screenId.trim());
  if (draft.kind === "visual") {
    if (!draft.criteria.trim()) return false;
    if (draft.region.trim() && !parseRegion(draft.region)) return false;
    return true;
  }
  if (draft.kind === "semantic") return Boolean(draft.input.trim() && draft.criteria.trim());
  if (draft.kind === "wait-response") {
    const maxMs = Number(draft.maxMs);
    return Boolean(
      draft.label.trim() &&
      (draft.maxMs.trim() === "" ||
        (Number.isSafeInteger(maxMs) && maxMs >= 1 && maxMs <= 900_000)),
    );
  }
  if (draft.kind === "extract") return Boolean(draft.as.trim() && draft.label.trim());
  if (draft.kind === "identity-ignore") return Boolean(parseRegion(draft.region));
  if (draft.match === "field")
    return Boolean(draft.input.trim() && draft.expected.trim() && draft.field?.trim());
  return Boolean(draft.input.trim() && draft.expected.trim());
}

export function validWaitSeconds(value: string): boolean {
  const seconds = Number(value);
  return (
    value.trim() !== "" &&
    Number.isFinite(seconds) &&
    seconds > 0 &&
    seconds <= 900 &&
    Number.isSafeInteger(seconds * 1000)
  );
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseRegion(
  value: string,
): { x: number; y: number; width: number; height: number } | undefined {
  const parts = value.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

export function validationBindingFromDraft(
  draft: ValidationDraft,
): Extract<AppMapTestResolvedBinding, { kind: "assertion" | "recipe-step" }> {
  if (draft.kind === "wait-for") {
    if (!isValidationDraftReady(draft))
      throw new Error("Enter a control and a wait between 0.001 and 900 seconds.");
    const originalTarget = draft.assertionSource?.target ?? draft.source?.target;
    const target =
      originalTarget?.label === draft.label.trim()
        ? { ...originalTarget }
        : { label: draft.label.trim() };
    if (draft.assertionSource)
      return {
        status: "resolved",
        kind: "assertion",
        assertion: {
          ...draft.assertionSource,
          target,
          condition: draft.condition,
          timeoutMs: Number(draft.seconds) * 1000,
        },
      };
    return {
      status: "resolved",
      kind: "recipe-step",
      step: {
        ...draft.source,
        kind: "expect",
        target,
        condition: draft.condition,
        timeoutMs: Number(draft.seconds) * 1000,
      },
    };
  }
  if (draft.kind === "capture") {
    const lookFor = draft.lookFor.trim();
    return {
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "screenshot",
        caption: draft.name.trim(),
        review: { mode: "later", ...(lookFor ? { lookFor } : {}) },
      },
    };
  }
  if (draft.kind === "wait-response") {
    if (!isValidationDraftReady(draft))
      throw new Error("Enter a reply control and a maximum duration between 1 and 900000 ms.");
    const originalTarget = draft.source?.target;
    const originalLabel = originalTarget
      ? (controlLabel(originalTarget) ?? originalTarget.ref)
      : undefined;
    const step: Extract<RecipeStep, { kind: "wait-response" }> = {
      ...draft.source,
      kind: "wait-response",
      target:
        originalTarget && originalLabel?.trim() === draft.label.trim()
          ? { ...originalTarget }
          : { label: draft.label.trim() },
    };
    delete step.maxMs;
    if (draft.maxMs.trim() !== "") step.maxMs = Number(draft.maxMs);
    return {
      status: "resolved",
      kind: "recipe-step",
      step,
    };
  }
  if (draft.kind === "extract") {
    return {
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "extract",
        as: draft.as.trim(),
        target: { label: draft.label.trim() },
        ...(draft.role === "user" || draft.role === "assistant" ? { role: draft.role } : {}),
      },
    };
  }
  if (draft.kind === "visual") {
    const region = parseRegion(draft.region);
    return {
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "visual",
        criteria: lines(draft.criteria),
        ...(region ? { region } : {}),
        ...(draft.requireAgreement ? { requireAgreement: true } : {}),
      },
    };
  }
  if (draft.kind === "upload") {
    const file = draft.file.trim();
    const label = draft.label.trim();
    return {
      status: "resolved",
      kind: "recipe-step",
      step: { kind: "upload", file, ...(label ? { target: { label } } : {}) },
    };
  }
  if (draft.kind === "identity-ignore") {
    const region = parseRegion(draft.region);
    if (!region) throw new Error("identity-ignore requires x,y,w,h");
    return {
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "identity-ignore",
        region,
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
      },
    };
  }
  if (draft.kind === "semantic") {
    return {
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "semantic",
        input: draft.input.trim(),
        criteria: lines(draft.criteria),
        ...(draft.requireAgreement ? { requireAgreement: true } : {}),
      },
    };
  }
  return { status: "resolved", kind: "assertion", assertion: draft };
}

export const IDENTITY_IGNORE_PRESETS = [
  {
    id: "reply-body",
    name: "reply body",
    region: "0.08,0.30,0.84,0.55",
    label: "Reply body",
    detail: "Chrome stays compared. Do not use this on a logged-out paywall.",
  },
  {
    id: "user-bubble",
    name: "user bubble",
    region: "0.70,0.08,0.28,0.10",
    label: "User bubble",
    detail: "Paywall card stays compared.",
  },
  {
    id: "cookie-banner",
    name: "cookie banner",
    region: "0.57,0.80,0.43,0.20",
    label: "Cookie banner",
    detail: "Essential cookies dialog. Do not bake the banner into a visual baseline.",
  },
  {
    id: "composer-placeholder",
    name: "composer placeholder",
    region: "0.21,0.29,0.57,0.06",
    label: "Composer placeholder",
    detail:
      "Rotating Build Mode / Ask anything text. Do not cover Imagine gallery, paywall, or SuperGrok upsell.",
  },
  {
    id: "heading-caret",
    name: "heading caret",
    region: "0.53,0.25,0.08,0.01",
    label: "Heading caret",
    detail: "Blinking underline under explore?. Does not cover the Grok heading text.",
  },
  {
    id: "library-chrome-sandwich",
    name: "library chrome sandwich",
    region: "0.06,0.14,0.88,0.60",
    label: "Library chrome sandwich",
    detail:
      "Infinite Library / Imagine / Conversations feed. One viewport. Top and bottom chrome stay compared. Do not survey the feed.",
  },
] as const;

export function emptyValidationDraft(kind: ValidationDraft["kind"]): ValidationDraft {
  if (kind === "wait-for")
    return { kind: "wait-for", label: "", condition: "visible", seconds: "60" };
  if (kind === "capture") return { kind: "capture", name: "", lookFor: "" };
  if (kind === "screen") return { kind: "screen", screenId: "" };
  if (kind === "visual")
    return { kind: "visual", criteria: "", region: "", requireAgreement: true };
  if (kind === "semantic")
    return { kind: "semantic", input: "reply", criteria: "", requireAgreement: true };
  if (kind === "wait-response") return { kind: "wait-response", label: "", maxMs: "" };
  if (kind === "extract") return { kind: "extract", as: "reply", label: "", role: "assistant" };
  if (kind === "identity-ignore")
    return { kind: "identity-ignore", name: "reply body", region: "" };
  if (kind === "upload") return { kind: "upload", file: "tests/fixtures/sample.pdf", label: "" };
  return { kind: "content", input: "", expected: "", match: "contains" };
}

export function validationPatch(
  stepId: string,
  draft: ValidationDraft,
): Extract<AppMapScenarioTestEdit, { kind: "step.patch" }> {
  return { kind: "step.patch", stepId, patch: { binding: validationBindingFromDraft(draft) } };
}

export function sameValidationDraft(left?: ValidationDraft, right?: ValidationDraft): boolean {
  if (left?.kind === "wait-for" && right?.kind === "wait-for") {
    return (
      left.label === right.label &&
      left.condition === right.condition &&
      left.seconds === right.seconds
    );
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
