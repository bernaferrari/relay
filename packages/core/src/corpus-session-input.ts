/**
 * Validation and canonicalization for persisted corpus-session input.
 *
 * It deliberately contains no device or storage work: callers can normalize
 * a session offline before a crawl ever touches a target.
 */
import type { CorpusJourney, CorpusJourneyStep, CorpusNavStep, CorpusScope } from "@relay/protocol";

const defaultScope: CorpusScope = {
  maxDepth: 3,
  maxScreens: 400,
  maxTransitions: 1_200,
  maxDurationMs: 45 * 60_000,
  locales: ["en"],
  strategy: "map-once-replay",
  allowSensitiveControls: false,
};

const maxCorpusLocales = 250;

export function requiredCorpusText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}

function optionalCorpusText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredCorpusText(value, label, maxLength);
}

function normalizeNavSteps(value: unknown, label: string): CorpusNavStep[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((step, index) => {
    if (!step || typeof step !== "object") throw new Error(`${label}[${index}] is invalid`);
    const record = step as Record<string, unknown>;
    const kind = record.kind;
    if (kind === "back") return { kind: "back" };
    if (kind === "relaunch") return { kind: "relaunch" };
    if (kind === "openApp") {
      const appName = optionalCorpusText(record.app, `${label}[${index}].app`, 240);
      if (!appName) throw new Error(`${label}[${index}].app is required`);
      const relaunch = record.relaunch === undefined ? undefined : Boolean(record.relaunch);
      return { kind: "openApp", app: appName, ...(relaunch !== undefined ? { relaunch } : {}) };
    }
    if (kind === "wait") {
      const ms = Number(record.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) {
        throw new Error(`${label}[${index}].ms is invalid`);
      }
      return { kind: "wait", ms: Math.round(ms) };
    }
    if (kind === "scroll") {
      const direction = record.direction === "up" ? "up" : "down";
      const amount =
        record.amount === undefined
          ? undefined
          : Math.max(1, Math.min(8, Number(record.amount) || 1));
      return { kind: "scroll", direction, ...(amount ? { amount } : {}) };
    }
    if (kind === "tap") {
      const target = (record.target ?? {}) as Record<string, unknown>;
      const identifier = optionalCorpusText(
        target.identifier,
        `${label}[${index}].target.identifier`,
        240,
      );
      const stableKey = optionalCorpusText(
        target.stableKey,
        `${label}[${index}].target.stableKey`,
        500,
      );
      const tapLabel = optionalCorpusText(target.label, `${label}[${index}].target.label`, 240);
      const text = optionalCorpusText(target.text, `${label}[${index}].target.text`, 240);
      const point = target.point as Record<string, unknown> | undefined;
      const x = point ? Number(point.x) : Number.NaN;
      const y = point ? Number(point.y) : Number.NaN;
      const validPoint = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0;
      if (!stableKey && !identifier && !tapLabel && !text && !validPoint) {
        throw new Error(`${label}[${index}] tap target requires identifier, label, text, or point`);
      }
      return {
        kind: "tap",
        target: {
          ...(identifier ? { identifier } : {}),
          ...(stableKey ? { stableKey } : {}),
          ...(tapLabel ? { label: tapLabel } : {}),
          ...(text ? { text } : {}),
          ...(validPoint ? { point: { x, y } } : {}),
        },
      };
    }
    throw new Error(`${label}[${index}].kind is unsupported`);
  });
}

function normalizeJourneys(value: unknown): CorpusJourney[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("journeys must be an array");
  const seen = new Set<string>();
  return value.map((journey, journeyIndex) => {
    if (!journey || typeof journey !== "object") {
      throw new Error(`journeys[${journeyIndex}] is invalid`);
    }
    const record = journey as Record<string, unknown>;
    const id = requiredCorpusText(record.id, `journeys[${journeyIndex}].id`, 120);
    if (seen.has(id)) throw new Error(`duplicate journey id: ${id}`);
    seen.add(id);
    const name = requiredCorpusText(record.name, `journeys[${journeyIndex}].name`, 160);
    if (!Array.isArray(record.steps) || !record.steps.length) {
      throw new Error(`journeys[${journeyIndex}].steps must not be empty`);
    }
    const steps = record.steps.map((step, stepIndex): CorpusJourneyStep => {
      if (!step || typeof step !== "object") {
        throw new Error(`journeys[${journeyIndex}].steps[${stepIndex}] is invalid`);
      }
      const stepRecord = step as Record<string, unknown>;
      if (stepRecord.kind === "capture") {
        return {
          kind: "capture",
          name: requiredCorpusText(
            stepRecord.name,
            `journeys[${journeyIndex}].steps[${stepIndex}].name`,
            160,
          ),
          ...(optionalCorpusText(
            stepRecord.key,
            `journeys[${journeyIndex}].steps[${stepIndex}].key`,
            120,
          )
            ? {
                key: optionalCorpusText(
                  stepRecord.key,
                  `journeys[${journeyIndex}].steps[${stepIndex}].key`,
                  120,
                )!,
              }
            : {}),
        };
      }
      return normalizeNavSteps([step], `journeys[${journeyIndex}].steps[${stepIndex}]`)![0]!;
    });
    if (!steps.some((step) => step.kind === "capture")) {
      throw new Error(`journey ${id} requires at least one capture step`);
    }
    return { id, name, steps };
  });
}

export function normalizeCorpusScope(scope?: Partial<CorpusScope>): CorpusScope {
  const bounded = (
    value: number | undefined,
    fallback: number,
    min: number,
    max: number,
    name: string,
  ) => {
    const next = value ?? fallback;
    if (!Number.isInteger(next) || next < min || next > max) {
      throw new Error(`invalid corpus scope: ${name}`);
    }
    return next;
  };
  const locales = [
    ...new Set(
      (scope?.locales?.length ? scope.locales : defaultScope.locales)
        .map((locale) => locale.trim())
        .filter(Boolean),
    ),
  ];
  if (!locales.length) throw new Error("corpus requires at least one locale");
  if (locales.length > maxCorpusLocales) {
    throw new Error(`corpus supports at most ${maxCorpusLocales} locales`);
  }
  const languageOptions = scope?.languageOptions
    ? Object.fromEntries(
        Object.entries(scope.languageOptions).map(([locale, steps]) => [
          locale,
          normalizeNavSteps(steps, `languageOptions.${locale}`) ?? [],
        ]),
      )
    : undefined;
  const strategy =
    scope?.strategy === "crawl-each" || scope?.strategy === "map-once-replay"
      ? scope.strategy
      : (defaultScope.strategy ?? "map-once-replay");
  const mapLocale = optionalCorpusText(scope?.mapLocale, "mapLocale", 40) ?? locales[0]!;
  if (!locales.includes(mapLocale)) {
    locales.unshift(mapLocale);
  }
  // Map locale first so UI/coverage order is natural.
  const orderedLocales = [mapLocale, ...locales.filter((locale) => locale !== mapLocale)];
  const entryPath = normalizeNavSteps(scope?.entryPath, "entryPath");
  const languagePath = normalizeNavSteps(scope?.languagePath, "languagePath");
  const journeys = normalizeJourneys(scope?.journeys);
  return {
    maxDepth: bounded(scope?.maxDepth, defaultScope.maxDepth, 0, 6, "maxDepth"),
    maxScreens: bounded(scope?.maxScreens, defaultScope.maxScreens, 1, 2_000, "maxScreens"),
    maxTransitions: bounded(
      scope?.maxTransitions,
      defaultScope.maxTransitions,
      1,
      8_000,
      "maxTransitions",
    ),
    maxDurationMs: bounded(
      scope?.maxDurationMs,
      defaultScope.maxDurationMs,
      30_000,
      8 * 60 * 60_000,
      "maxDurationMs",
    ),
    locales: orderedLocales,
    strategy,
    mapLocale,
    ...(optionalCorpusText(scope?.app, "app", 240)
      ? { app: optionalCorpusText(scope?.app, "app", 240) }
      : {}),
    ...(entryPath ? { entryPath } : {}),
    ...(languagePath ? { languagePath } : {}),
    ...(languageOptions && Object.keys(languageOptions).length ? { languageOptions } : {}),
    ...(journeys ? { journeys } : {}),
    allowSensitiveControls: scope?.allowSensitiveControls ?? false,
  };
}
