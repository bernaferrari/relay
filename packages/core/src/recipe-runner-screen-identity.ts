import type { RecipeStep } from "./recipes.js";
import type { TestJob } from "./session.js";
import {
  compareScreenIdentity,
  localeNeutralStructureSignature,
  observeScreenIdentity,
} from "./screen-identity.js";

function isLocalizedRecipeJob(job?: TestJob): boolean {
  const locale = (job?.resolvedInputs?.language ?? job?.resolvedInputs?.locale ?? "")
    .trim()
    .toLocaleLowerCase();
  return Boolean(locale && !/^en(?:-|$)/.test(locale));
}

/**
 * App-locale runs intentionally change visible text, so an English semantic
 * fingerprint cannot be the only screen proof. Stable platform identifiers
 * plus near-identical accessibility structure are a strict, language-neutral
 * substitute. Labels alone never qualify: that would make an unrelated
 * translated surface look like the recorded screen.
 */
function meaningfulStableIdentifiers(
  observation: ReturnType<typeof observeScreenIdentity>,
): Set<string> {
  return new Set(
    observation.nodes.flatMap((node) => {
      const identifier = node.identifier;
      if (!identifier) return [];
      if (identifier === "android:id/content" || identifier.endsWith(":id/action_bar_root")) {
        return [];
      }
      return [identifier];
    }),
  );
}

export function resilientScreenIdentityMatch(
  observed: ReturnType<typeof observeScreenIdentity>,
  observations: NonNullable<Extract<RecipeStep, { kind: "expect-screen" }>["observations"]>,
  job?: TestJob,
  options: { allowDynamicShell?: boolean; screenTitle?: string } = {},
): boolean {
  const localized = isLocalizedRecipeJob(job);
  const structureSignature = localeNeutralStructureSignature(observed);
  const normalizedTitle = options.screenTitle?.trim().toLocaleLowerCase();
  const observedLabels = new Set(
    observed.nodes.flatMap((node) => (node.label ? [node.label.trim().toLocaleLowerCase()] : [])),
  );
  return observations.some((observation) => {
    const comparison = compareScreenIdentity(observed, observation);
    const stableIdentifiers = comparison.signals.find(
      (signal) => signal.kind === "stable-identifier-overlap" && signal.impact === "positive",
    )?.strength;
    const structure = comparison.signals.find(
      (signal) => signal.kind === "structural-overlap" && signal.impact === "positive",
    )?.strength;
    const expectedIdentifiers = meaningfulStableIdentifiers(observation);
    const observedIdentifiers = meaningfulStableIdentifiers(observed);
    const sharedIdentifiers = [...expectedIdentifiers].filter((identifier) =>
      observedIdentifiers.has(identifier),
    );
    // Dynamic lists can replace most visible copy and change row count while
    // leaving a compact application-owned identifier set intact. Grok
    // Navigation is the usual case: profile_section + settings_button +
    // new_conversation_button stay put, conversation titles do not. Role-bag
    // overlap across that list is not screen identity — a handful of extra or
    // missing rows already drops a ~80-node tree below 0.95.
    // Richer shells (six or more reviewed identifiers) stay on the explicit
    // handoff rule so a reflowed system Settings page cannot match without
    // its declared owner app.
    const stableApplicationShell =
      expectedIdentifiers.size >= 2 &&
      expectedIdentifiers.size <= 5 &&
      observedIdentifiers.size === expectedIdentifiers.size &&
      sharedIdentifiers.length === expectedIdentifiers.size;
    const expectedLabels = new Set(
      observation.nodes.flatMap((node) =>
        node.label ? [node.label.trim().toLocaleLowerCase()] : [],
      ),
    );
    // Some Compose lists expose no product-owned identifiers at all. Their
    // rows are user data, so count and copy legitimately churn between runs.
    // A reviewed page title plus a second exact descriptive shell label is a
    // much stronger invariant than the row bag and remains fail-closed for a
    // child page that merely shares app chrome. One title alone never matches.
    const stableSemanticShell =
      Boolean(normalizedTitle && expectedLabels.has(normalizedTitle)) &&
      observedLabels.has(normalizedTitle!) &&
      [...expectedLabels].some(
        (label) => label !== normalizedTitle && label.length >= 24 && observedLabels.has(label),
      );
    return (
      (options.allowDynamicShell !== false && (stableApplicationShell || stableSemanticShell)) ||
      (localized && (stableIdentifiers ?? 0) >= 0.98 && (structure ?? 0) >= 0.95) ||
      (localized &&
        structureSignature !== undefined &&
        structureSignature === localeNeutralStructureSignature(observation))
    );
  });
}

/** Cross-app handoffs can land at a different scroll offset while still
 * exposing the exact same reviewed, package-owned shell. This deliberately
 * requires a much richer identifier set than the generic dynamic-list rule;
 * the caller separately proves the foreground package. */
export function handoffShellIdentityMatch(
  observed: ReturnType<typeof observeScreenIdentity>,
  observations: NonNullable<Extract<RecipeStep, { kind: "expect-screen" }>["observations"]>,
): boolean {
  const observedIdentifiers = meaningfulStableIdentifiers(observed);
  return observations.some((observation) => {
    const expectedIdentifiers = meaningfulStableIdentifiers(observation);
    if (expectedIdentifiers.size < 6 || observedIdentifiers.size !== expectedIdentifiers.size) {
      return false;
    }
    if ([...expectedIdentifiers].some((identifier) => !observedIdentifiers.has(identifier))) {
      return false;
    }
    const structure = compareScreenIdentity(observed, observation).signals.find(
      (signal) => signal.kind === "structural-overlap" && signal.impact === "positive",
    )?.strength;
    return (structure ?? 0) >= 0.9;
  });
}
