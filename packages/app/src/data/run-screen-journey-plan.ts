type RecordValue = Record<string, unknown>;
export type JourneyJob = {
  recipeSnapshot?: unknown;
  recipeGraph?: unknown;
  artifacts?: unknown;
  steps?: unknown;
};

const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined;
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
type Checkpoint = { step: RecordValue; recipeId?: string; dependencies: unknown[] };

export function frozenRunScreenContext(job: JourneyJob) {
  const artifacts = array(job.artifacts).flatMap((value) =>
    record(value) ? [record(value)!] : [],
  );
  const snapshot = record(artifacts.find((a) => a.kind === "app-map-player-snapshot")?.data);
  const graph = record(job.recipeGraph);
  const checkpoints: Checkpoint[] = [];
  function walk(recipe: RecordValue | undefined, path: Set<string>, dependencies: unknown[] = []) {
    const recipeId = text(recipe?.id);
    if (!recipe || !recipeId || path.has(recipeId)) return;
    const next = new Set(path);
    if (recipeId) next.add(recipeId);
    for (const raw of array(recipe.steps)) {
      const step = record(raw);
      if (step?.kind === "expect-screen") checkpoints.push({ step, recipeId, dependencies });
      if (step?.kind === "module") {
        const childId = text(step.recipeId);
        const childDependencies = array(record(step.check)?.transitionDependencies);
        walk(
          childId ? record(graph?.[childId]) : undefined,
          next,
          childDependencies.length ? childDependencies : dependencies,
        );
      }
    }
  }
  walk(record(job.recipeSnapshot), new Set());
  const screens = new Map<string, { title: string; fingerprints: Set<string> }>();
  function add(id: string | undefined, title: unknown, fingerprint: unknown, aliases: unknown) {
    if (!id) return;
    const screen = screens.get(id) ?? { title: text(title) ?? id, fingerprints: new Set<string>() };
    for (const value of [fingerprint, ...array(aliases)])
      if (text(value)) screen.fingerprints.add(text(value)!);
    screens.set(id, screen);
  }
  for (const [id, raw] of Object.entries(record(snapshot?.screens) ?? {})) {
    const screen = record(raw),
      identity = record(screen?.identity);
    add(id, screen?.title, identity?.fingerprint, identity?.aliases);
  }
  // Frozen recipes retain approved identities even when the compact map snapshot omits them.
  for (const recipe of [record(job.recipeSnapshot), ...Object.values(graph ?? {}).map(record)]) {
    for (const raw of array(recipe?.steps)) {
      const step = record(raw);
      if (step?.kind === "expect-screen")
        add(text(step.screenId), step.screenTitle, step.fingerprint, step.aliases);
    }
  }
  return { artifacts, snapshot, checkpoints, screens };
}

/** IDs are authoritative. A fingerprint must match exactly one frozen identity or approved alias. */
export function matchRunScreenIdentity(
  job: JourneyJob,
  observation: { screenId?: string; fingerprint?: string },
): string | undefined {
  const { screens } = frozenRunScreenContext(job);
  if (observation.screenId)
    return screens.has(observation.screenId) ? observation.screenId : undefined;
  const matches = [...screens].filter(([, screen]) =>
    Boolean(observation.fingerprint && screen.fingerprints.has(observation.fingerprint)),
  );
  return matches.length === 1 ? matches[0]?.[0] : undefined;
}
