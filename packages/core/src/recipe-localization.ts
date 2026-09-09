import {
  compareScreenIdentity,
  observeScreenIdentity,
  type ScreenIdentityComparison,
  type ScreenIdentityObservation,
} from "./screen-identity.js";
import type { SnapshotNode } from "./device.js";
import { currentTargetContext } from "./target-context.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { foregroundApplicationBundle } from "./recipe-runner-tour-matching.js";
import {
  loadAndroidResourceStringIndex,
  type AndroidResourceStringLoaderOptions,
} from "./android-resource-string-loader.js";
import type { AndroidResourceStringLookup } from "./android-resource-strings.js";

export type RecipeAndroidLocalization = {
  packageName: string;
  locale: string;
  translate: (text: string) => string | undefined;
  lookup?: (text: string) => AndroidResourceStringLookup;
};

type Loader = (
  serial: string,
  packageName: string,
  options: AndroidResourceStringLoaderOptions,
) => Promise<
  | {
      packageName?: string;
      index: {
        lookup: (source: string) => AndroidResourceStringLookup;
        values: readonly { value: string }[];
        sources?: readonly string[];
      };
      currentAppLocale?: string;
    }
  | undefined
>;

const cache = new WeakMap<object, Map<string, Promise<RecipeAndroidLocalization | undefined>>>();
const normalizedSources = new WeakMap<object, Map<string, string[]>>();

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function packageInIdentifier(identifier: string | undefined): string | undefined {
  const value = identifier?.trim();
  if (!value) return undefined;
  const match = /^(?:resource:)?([A-Za-z][A-Za-z0-9._-]*):id\//u.exec(value);
  return match?.[1];
}

/** Reject an observation whose Android resource identifiers belong to another app. */
export function observationResourcePackage(
  observation: Pick<ScreenIdentityObservation, "nodes">,
  packageName: string,
): boolean {
  let appAnchor = false;
  const consistent = observation.nodes.every((node) => {
    const owner = packageInIdentifier(node.identifier);
    if (owner === packageName) appAnchor = true;
    return !owner || owner === packageName || owner === "android";
  });
  return consistent && appAnchor;
}

function lookupNormalized(
  index: {
    lookup: (source: string) => AndroidResourceStringLookup;
    values: readonly { value: string }[];
    sources?: readonly string[];
  },
  source: string,
): AndroidResourceStringLookup {
  const direct = index.lookup(source);
  if (direct.status !== "missing") return direct;
  const wanted = normalized(source);
  let sources = normalizedSources.get(index);
  if (!sources) {
    sources = new Map();
    for (const value of index.sources ?? [...new Set(index.values.map((item) => item.value))]) {
      const key = normalized(value);
      const variants = sources.get(key) ?? [];
      if (!variants.includes(value)) variants.push(value);
      sources.set(key, variants);
    }
    normalizedSources.set(index, sources);
  }
  const candidates = sources.get(wanted) ?? [];
  if (candidates.length === 0) return direct;
  const results = candidates.map((candidate) => index.lookup(candidate));
  const matched = results.filter((item) => item.status === "matched");
  const targets = [...new Set(matched.map((item) => item.target))];
  if (!matched.length && !results.some((item) => item.status === "ambiguous")) return direct;
  if (
    targets.length === 1 &&
    matched.length > 0 &&
    !results.some((item) => item.status === "ambiguous")
  )
    return matched[0]!;
  return {
    status: "ambiguous",
    source,
    candidates: results.flatMap((item) =>
      item.status === "matched"
        ? [{ key: item.key, target: item.target }]
        : item.status === "ambiguous"
          ? item.candidates
          : [],
    ),
  };
}

export function localizeExpectedObservation(
  observation: ScreenIdentityObservation,
  localization: RecipeAndroidLocalization,
  observed?: ScreenIdentityObservation,
): ScreenIdentityObservation | undefined {
  if (!observationResourcePackage(observation, localization.packageName)) return undefined;
  const sameAnchor = (
    left: ScreenIdentityObservation["nodes"][number],
    right: ScreenIdentityObservation["nodes"][number],
  ) => Boolean(left.identifier && left.identifier === right.identifier && left.role === right.role);
  // Generic resource captions can have several translations. They only
  // support identity after an independent, package-owned translated anchor
  // matches, and only at a unique native node on both screens.
  const hasIndependentAnchor = observation.nodes.some((node) => {
    if (packageInIdentifier(node.identifier) !== localization.packageName || !node.label)
      return false;
    const result = localization.lookup?.(node.label);
    return (
      result?.status === "matched" &&
      normalized(result.target) !== node.label &&
      observed?.nodes.some(
        (live) => sameAnchor(node, live) && live.label === normalized(result.target),
      )
    );
  });
  const translateField = (
    text: string | undefined,
    node: ScreenIdentityObservation["nodes"][number],
    field: "label" | "value",
  ) => {
    if (!text) return text;
    const result = localization.lookup?.(text);
    if (
      result?.status === "ambiguous" &&
      hasIndependentAnchor &&
      observation.nodes.filter((candidate) => sameAnchor(node, candidate)).length === 1
    ) {
      const live = observed?.nodes.filter((candidate) => sameAnchor(node, candidate)) ?? [];
      if (
        live.length === 1 &&
        live[0]?.[field] &&
        result.candidates.some((candidate) => normalized(candidate.target) === live[0]![field])
      ) {
        return live[0]![field];
      }
    }
    return result?.status === "matched" ? normalized(result.target) : text;
  };
  const nodes = observation.nodes.map((node) => {
    // A generic caption (On, Off, Connected) may have several translations.
    // Keep it unmatched rather than guessing or discarding the other screen
    // anchors. A control selected by this text still requires a unique lookup.
    return {
      ...node,
      label: translateField(node.label, node, "label"),
      value: translateField(node.value, node, "value"),
    };
  });
  return observeScreenIdentity(
    nodes.map((node) => ({
      role: node.role,
      type: node.role,
      label: node.label,
      value: node.value,
      identifier: node.identifier,
      enabled: node.enabled,
      selected: node.selected,
      focused: node.focused,
      hittable: node.hittable,
      depth: node.depth,
    })),
  );
}

/**
 * Android Settings detail pages contain live usage totals and an app list.
 * Those values legitimately change between the English teaching capture and a
 * localized replay, so an exact fingerprint is unavailable. Accept the
 * localized identity only when the package-owned translated anchor is present
 * at the same native node and the stable resource structure remains nearly
 * identical. This policy is deliberately narrower than the general identity
 * threshold and cannot match on text or visual similarity alone.
 */
export function localizedScreenIdentityMatches(
  observed: ScreenIdentityObservation,
  localized: ScreenIdentityObservation,
  source: ScreenIdentityObservation,
  localization: RecipeAndroidLocalization,
): boolean {
  const comparison: ScreenIdentityComparison = compareScreenIdentity(observed, localized);
  const identifierOverlap = comparison.signals.find(
    (signal) => signal.kind === "stable-identifier-overlap",
  )?.strength;
  if (identifierOverlap === undefined || identifierOverlap < 0.9) return false;
  const exactTranslatedAnchor = source.nodes.some((node) => {
    const owner = packageInIdentifier(node.identifier);
    if (
      owner !== localization.packageName ||
      !node.identifier?.endsWith(":id/collapsing_toolbar") ||
      !node.label
    )
      return false;
    const translation = localization.lookup?.(node.label);
    if (translation?.status !== "matched") return false;
    return observed.nodes.some(
      (live) =>
        live.identifier === node.identifier &&
        live.role === node.role &&
        live.label !== undefined &&
        normalized(live.label) === normalized(translation.target),
    );
  });
  return exactTranslatedAnchor;
}

function runtimeKey(ctx: RecipeStepContext): object | undefined {
  return ctx.runtime ?? ctx.job;
}

/** Resolve the installed Android app's current locale without consulting job inputs. */
export async function getRecipeAndroidLocalization(
  ctx: RecipeStepContext,
  nodes: SnapshotNode[],
  options: { load?: Loader } = {},
): Promise<RecipeAndroidLocalization | undefined> {
  const target =
    ctx.job?.targetContext ??
    (() => {
      try {
        return currentTargetContext();
      } catch {
        return undefined;
      }
    })();
  if ((ctx.job?.platform ?? target?.platform) !== "android" || target?.kind === "browser")
    return undefined;
  const serial = ctx.job?.serial ?? (target?.kind === "device" ? target.serial : undefined);
  const packageName = foregroundApplicationBundle(nodes);
  const key = runtimeKey(ctx);
  if (!serial || !packageName || !key) return undefined;
  let byPackage = cache.get(key);
  if (!byPackage) cache.set(key, (byPackage = new Map()));
  const existing = byPackage.get(packageName);
  if (existing) return existing;
  const loader = options.load ?? loadAndroidResourceStringIndex;
  const pending = loader(serial, packageName, {})
    .then((loaded) => {
      if (!loaded) return undefined;
      const { index, currentAppLocale } = loaded;
      const locale = currentAppLocale?.trim();
      if (!locale) return undefined;
      return {
        packageName,
        locale,
        lookup: (text: string) => lookupNormalized(index, text),
        translate: (text: string) => {
          const result = lookupNormalized(index, text);
          return result.status === "matched" ? result.target : undefined;
        },
      };
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === "JobCancelledError") throw error;
      ctx.log(`localization: app resources unavailable for ${packageName}`);
      return undefined;
    });
  byPackage.set(packageName, pending);
  return pending;
}
