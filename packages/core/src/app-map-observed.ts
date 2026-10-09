/**
 * Project what runs actually saw onto an App Map. Every run feeds it, pass or
 * fail, and screens the map does not know are kept as "new" instead of being
 * dropped. It is rebuilt from immutable run reports, so it needs no store and
 * never changes the reviewed map that Tests compile from.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  AppMap,
  AppMapObserved,
  AppMapObservedScreen,
  AppMapObservedTransition,
  RunOutcome,
  ScreenIdentityObservation,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { runsRoot, type PersistedRun } from "./runs.js";
import { readFrameTreeNodes } from "./run-frame-tree.js";
import { observeScreenIdentityForHost, resolveScreenIdentity } from "./screen-identity.js";

const DEFAULT_RUN_LIMIT = 200;
const MIN_IDENTITY_NODES = 3;

/** One identified frame of one run, in capture order. */
export type ObservedRunFrame = {
  fingerprint: string;
  /** Normalized visible semantics, for fuzzy matching when content changes. */
  observation?: ScreenIdentityObservation;
  titleGuess: string;
  file: string;
  capturedAt: number;
  /** What the run was doing when the frame was captured. */
  stepTitle?: string;
};

export type ObservedRun = {
  runId: string;
  outcome?: RunOutcome;
  finishedAt: number;
  frames: ObservedRunFrame[];
};

const HEADING_ROLE = /heading|header|navigationbar|title|^h[1-3]$/iu;
const CHROME_LABEL =
  /^(?:back|close|menu|more|search|done|cancel|ok|navigate up)$|^(?:show|hide|close|open|navigate|go to|toggle|dismiss|expand|collapse|skip|more options)\b/iu;
/** Status bar clocks, battery, and counters are device state, not screen names. */
const DEVICE_TEXT = /^(?:\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?|\d+%|[\d\s.,:%-]+)$/iu;
const SYSTEM_UI = /^com\.android\.systemui$/u;
/** Controls name actions ("Skip to main content"), not the screen they sit on. */
const CONTROL_ROLE =
  /button|link|image|switch|checkbox|radio|tab\b|menuitem|textfield|edittext|^a$|^a\s|\sa$|^svg|^path/iu;

/** A readable name for a screen the map does not know yet. */
export function guessScreenTitle(nodes: readonly SnapshotNode[]): string {
  const text = (node: SnapshotNode) => (node.label ?? node.value ?? "").trim();
  const isControl = (node: SnapshotNode) =>
    CONTROL_ROLE.test(`${node.role ?? ""} ${node.type ?? ""}`.trim());
  const controlLabels = new Set(nodes.filter(isControl).map(text).filter(Boolean));
  const visible = nodes.filter(
    (node) =>
      node.visibleToUser !== false &&
      (node.rect?.y ?? 0) >= 0 &&
      !SYSTEM_UI.test(node.bundleId ?? "") &&
      text(node) &&
      !text(node).includes("\n") &&
      !DEVICE_TEXT.test(text(node)),
  );
  const heading = visible.find(
    (node) =>
      HEADING_ROLE.test(`${node.role ?? ""} ${node.type ?? ""}`) &&
      text(node).length <= 60 &&
      !CHROME_LABEL.test(text(node)),
  );
  if (heading) return text(heading);
  const topText = visible
    .filter((node) => {
      const value = text(node);
      return (
        value.length >= 3 &&
        value.length <= 60 &&
        !CHROME_LABEL.test(value) &&
        !isControl(node) &&
        !controlLabels.has(value)
      );
    })
    .sort((left, right) => (left.rect?.y ?? Infinity) - (right.rect?.y ?? Infinity))[0];
  return topText ? text(topText) : "Untitled screen";
}

function stepTitleForFrame(run: PersistedRun, file: string): string | undefined {
  for (const step of run.steps) {
    if (step.frames.some((frame) => basename(frame.path) === file)) return step.title;
  }
  return undefined;
}

export async function observeRun(
  run: PersistedRun,
  appMapId: string,
): Promise<ObservedRun | undefined> {
  const finishedAt = run.finishedAt ?? run.writtenAt;
  if (run.status === "running" || run.status === "queued") return undefined;
  const frames: ObservedRunFrame[] = [];
  for (const frame of [...run.frames].sort((a, b) => a.capturedAt - b.capturedAt)) {
    const nodes = await readFrameTreeNodes(run.dir, frame.path);
    if (!nodes || nodes.length < MIN_IDENTITY_NODES) continue;
    const identity = observeScreenIdentityForHost(nodes.slice(0, 256), { appMapId });
    if (!identity.fingerprint) continue;
    const file = basename(frame.path);
    const stepTitle = stepTitleForFrame(run, file);
    frames.push({
      fingerprint: identity.fingerprint,
      observation: identity,
      titleGuess: guessScreenTitle(nodes),
      file,
      capturedAt: frame.capturedAt,
      ...(stepTitle ? { stepTitle } : {}),
    });
  }
  const observed: ObservedRun = {
    runId: run.id,
    ...(run.outcome ? { outcome: run.outcome } : {}),
    finishedAt,
    frames,
  };
  return observed;
}

type IdentityCandidate = { id: string; observation: ScreenIdentityObservation };

/** Exact fingerprint first, then the same fuzzy matcher repair uses. */
function matchScreen(
  map: AppMap,
  candidates: readonly IdentityCandidate[],
  frame: ObservedRunFrame,
): string | undefined {
  const exact = Object.values(map.screens).filter(
    (screen) =>
      screen.identity?.fingerprint === frame.fingerprint ||
      screen.identity?.aliases?.includes(frame.fingerprint),
  );
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1 || !frame.observation || !candidates.length) return undefined;
  const resolution = resolveScreenIdentity(frame.observation, candidates);
  return resolution.kind === "existing" ? resolution.match.candidate.id : undefined;
}

/** Pure projection, separated from disk access so it is easy to test. */
export function projectObservedRuns(map: AppMap, runs: readonly ObservedRun[]): AppMapObserved {
  type Tally = AppMapObservedScreen & { lastSeenAt?: number; lastFailedHere?: boolean };
  const screens = new Map<string, Tally>();
  for (const screen of Object.values(map.screens)) {
    screens.set(screen.id, {
      key: screen.id,
      screenId: screen.id,
      title: screen.title,
      status: "untested",
      runCount: 0,
    });
  }
  const transitions = new Map<string, AppMapObservedTransition & { lastAt: number }>();
  const ordered = [...runs].sort((left, right) => left.finishedAt - right.finishedAt);
  const known: IdentityCandidate[] = Object.values(map.screenVariants ?? {}).flatMap((variant) =>
    variant.observation && map.screens[variant.screenId]
      ? [{ id: variant.screenId, observation: variant.observation }]
      : [],
  );
  // Screens the map lacks are grouped the same way, so a chat whose text
  // changes every run is one new screen, not one per run.
  const fresh: IdentityCandidate[] = [];
  const freshByTitle = new Map<string, string>();
  const keyFor = (frame: ObservedRunFrame): string => {
    const screenId = matchScreen(map, known, frame);
    if (screenId) return screenId;
    const exact = fresh.find((item) => item.id === `new:${frame.fingerprint}`);
    if (exact) return exact.id;
    // People read the tray by name; one card per readable title.
    const title = frame.titleGuess.trim().toLocaleLowerCase();
    const named = title && title !== "untitled screen" ? freshByTitle.get(title) : undefined;
    if (named) return named;
    if (frame.observation && fresh.length) {
      const resolution = resolveScreenIdentity(frame.observation, fresh);
      if (resolution.kind === "existing") return resolution.match.candidate.id;
    }
    const id = `new:${frame.fingerprint}`;
    if (frame.observation) fresh.push({ id, observation: frame.observation });
    if (title && title !== "untitled screen") freshByTitle.set(title, id);
    return id;
  };
  for (const run of ordered) {
    const seenThisRun = new Set<string>();
    let previousKey: string | undefined;
    const keys = run.frames.map(keyFor);
    const lastKey = keys.at(-1);
    run.frames.forEach((frame, index) => {
      const key = keys[index]!;
      const tally =
        screens.get(key) ??
        ({ key, title: frame.titleGuess, status: "new", runCount: 0 } satisfies Tally);
      if (!seenThisRun.has(key)) {
        tally.runCount += 1;
        seenThisRun.add(key);
      }
      if (tally.lastSeenAt === undefined || frame.capturedAt >= tally.lastSeenAt) {
        tally.lastSeenAt = frame.capturedAt;
        tally.lastRunId = run.runId;
        if (run.outcome) tally.lastOutcome = run.outcome;
        else delete tally.lastOutcome;
        tally.lastFailedHere = run.outcome !== "passed" && key === lastKey;
        tally.frame = { runId: run.runId, file: frame.file, capturedAt: frame.capturedAt };
      }
      screens.set(key, tally);
      if (previousKey && previousKey !== key) {
        const id = `${previousKey}→${key}`;
        const existing = transitions.get(id);
        const label = frame.stepTitle?.trim() || "Continue";
        if (existing) {
          existing.count += 1;
          existing.label = label;
          existing.lastAt = frame.capturedAt;
          if (run.outcome) existing.lastOutcome = run.outcome;
        } else {
          transitions.set(id, {
            fromKey: previousKey,
            toKey: key,
            label,
            count: 1,
            lastAt: frame.capturedAt,
            ...(run.outcome ? { lastOutcome: run.outcome } : {}),
          });
        }
      }
      previousKey = key;
    });
  }
  const projected = [...screens.values()].map(({ lastFailedHere, ...screen }) => {
    if (screen.status !== "new" && screen.runCount > 0) {
      screen.status =
        screen.lastOutcome === "passed" ? "passing" : lastFailedHere ? "failing" : "seen";
    }
    return screen;
  });
  return {
    appMapId: map.id,
    runsScanned: runs.length,
    screens: projected,
    transitions: [...transitions.values()].map(({ lastAt: _lastAt, ...rest }) => rest),
    summary: {
      known: projected.filter((screen) => screen.screenId).length,
      tested: projected.filter((screen) => screen.screenId && screen.runCount > 0).length,
      failing: projected.filter((screen) => screen.status === "failing").length,
      new: projected.filter((screen) => screen.status === "new").length,
    },
  };
}

type RunIndexEntry = {
  dir: string;
  action: string;
  projectId?: string;
  /** Identified once, then reused: completed run reports never change. */
  observed?: ObservedRun | null;
};

/** Completed run directories are immutable; index each once per process. */
const runIndex = new Map<string, RunIndexEntry>();

async function readRunReport(dir: string): Promise<PersistedRun | undefined> {
  try {
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as PersistedRun;
    if (typeof run.action !== "string") return undefined;
    run.dir = dir;
    return run;
  } catch {
    return undefined;
  }
}

async function indexedRuns(): Promise<Map<string, RunIndexEntry>> {
  const root = runsRoot();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return runIndex;
  }
  for (const name of names) {
    if (runIndex.has(name)) continue;
    const dir = join(root, name);
    if (!existsSync(join(dir, ".complete"))) continue;
    const run = await readRunReport(dir);
    if (!run) continue;
    runIndex.set(name, {
      dir,
      action: run.action,
      ...(run.projectId ? { projectId: run.projectId } : {}),
    });
  }
  return runIndex;
}

export async function observeAppMapRuns(
  map: AppMap,
  options: { limit?: number } = {},
): Promise<AppMapObserved> {
  const prefix = `app-map:${map.id}:`;
  const entries = [...(await indexedRuns()).entries()]
    .filter(
      ([, entry]) =>
        entry.action.startsWith(prefix) && (!entry.projectId || entry.projectId === map.projectId),
    )
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, options.limit ?? DEFAULT_RUN_LIMIT);
  const observed: ObservedRun[] = [];
  for (const [, entry] of entries) {
    if (entry.observed === undefined) {
      const run = await readRunReport(entry.dir);
      entry.observed = run ? ((await observeRun(run, map.id)) ?? null) : null;
    }
    if (entry.observed?.frames.length) observed.push(entry.observed);
  }
  return projectObservedRuns(map, observed);
}
