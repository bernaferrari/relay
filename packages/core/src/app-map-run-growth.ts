/**
 * Runs grow the App Map on their own. Screens a run reached that the map does
 * not know are added with the run's screenshot and UI tree, and the moves the
 * run made between screens are added as draft paths.
 *
 * This is safe without review: Tests only replay ready connections and refuse
 * drafts, so nothing added here changes what a saved Test does. People fix
 * mistakes afterwards (rename, merge) instead of approving each screen.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppMap,
  AppMapBatchChange,
  Connection,
  ScreenVariant,
  TargetProfile,
} from "@relay/protocol";
import { commitAppMapChanges } from "./app-map/batch-operations.js";
import { canvasSlotAllocator } from "./app-map/canvas-slots.js";
import {
  knownScreenCandidates,
  matchScreen,
  observeRun,
  type IdentityCandidate,
  type ObservedRunFrame,
} from "./app-map-observed.js";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { createOpenRouterClient } from "./openrouter-ai-sdk.js";
import { readFrameTreeNodes } from "./run-frame-tree.js";
import { runsRoot, type PersistedRun } from "./runs.js";
import { resolveScreenIdentity } from "./screen-identity.js";

/** Names a new screen from its screenshot. Returns undefined to keep the guess. */
export type ScreenNamer = (input: {
  screenshot: Buffer;
  guess: string;
}) => Promise<string | undefined>;

let registeredNamer: ScreenNamer | undefined;

/** Test seam and local-provider hook. Returns an unregister function. */
export function registerScreenNamer(namer: ScreenNamer): () => void {
  registeredNamer = namer;
  return () => {
    if (registeredNamer === namer) registeredNamer = undefined;
  };
}

async function nameViaOpenRouter(input: {
  screenshot: Buffer;
  guess: string;
}): Promise<string | undefined> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return undefined;
  const model = process.env.OPENROUTER_VISION_MODEL ?? "openai/gpt-4o-mini";
  const { sdk, provider } = await createOpenRouterClient({
    apiKey: key,
    httpReferer: process.env.OPENROUTER_HTTP_REFERER,
    appTitle: process.env.OPENROUTER_APP_TITLE ?? "Relay",
  });
  const generated = await sdk.generateText({
    model: provider.chat(model),
    maxRetries: 1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Name this app screen in 1-4 words, the way a person would refer to it (for example "Checkout", "Account settings", "Search results"). A rough guess from its text is ${JSON.stringify(input.guess)}. Reply with the name only.`,
          },
          { type: "file", data: input.screenshot, mediaType: "image/png" },
        ],
      },
    ],
  });
  const name = generated.text
    .trim()
    .replace(/^["'“]|["'”.]$/gu, "")
    .trim();
  return name && name.length <= 60 ? name : undefined;
}

function appMapIdForRun(run: PersistedRun): string | undefined {
  return /^app-map:([^:]+):/u.exec(run.action)?.[1];
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16)}`;
}

function profileForRun(run: PersistedRun): TargetProfile | undefined {
  if (run.targetProfile) return run.targetProfile;
  const targetId = run.serial?.trim();
  const platform =
    run.platform === "ios" || run.platform === "android" || run.platform === "browser"
      ? run.platform
      : undefined;
  if (!targetId || !platform) return undefined;
  return {
    id: `${platform}:${targetId}`,
    targetId,
    source: platform === "browser" ? "browser" : "device",
    platform,
    name: run.deviceName?.trim() || targetId,
    capabilities: [],
    observedAt: run.startedAt ?? run.queuedAt,
  };
}

function alreadyConnected(map: AppMap, fromScreenId: string, toScreenId: string): boolean {
  return Object.values(map.connections).some(
    (connection) =>
      connection.fromScreenId === fromScreenId &&
      connection.destination.kind === "screen" &&
      connection.destination.screenId === toScreenId,
  );
}

/** Runner captions ("Capture for review · step:…") describe evidence, not a move. */
export function pathLabel(stepTitle: string | undefined): string {
  const title = stepTitle?.trim() ?? "";
  if (!title || /^(?:capture for review|screenshot|after ·|before ·)|\bstep:|^final:/iu.test(title))
    return "Continue";
  return title.length > 80 ? `${title.slice(0, 77).trimEnd()}…` : title;
}

type NewScreen = {
  screenId: string;
  frame: ObservedRunFrame;
  title: string;
  variant?: Omit<ScreenVariant, "organizationId" | "projectId" | "appMapId">;
};

/**
 * Pure planning step: which frames are new screens and which moves are new
 * draft paths. Kept separate from disk and model access so it is testable.
 */
export function planRunGrowth(
  map: AppMap,
  frames: readonly ObservedRunFrame[],
): {
  screens: Array<{ screenId: string; frame: ObservedRunFrame }>;
  paths: Array<{ fromScreenId: string; toScreenId: string; label: string; at: number }>;
} {
  const known = knownScreenCandidates(map);
  // A name that matches exactly one screen already on the map is that screen.
  // Layout or content can differ (a defect, a new chat) without being new.
  const byTitle = new Map<string, string[]>();
  for (const screen of Object.values(map.screens)) {
    const title = screen.title.trim().toLocaleLowerCase();
    byTitle.set(title, [...(byTitle.get(title) ?? []), screen.id]);
  }
  const added: Array<{ screenId: string; frame: ObservedRunFrame }> = [];
  const addedCandidates: IdentityCandidate[] = [];
  const addedByTitle = new Map<string, string>();
  const keys = frames.map((frame) => {
    const existing = matchScreen(map, known, frame);
    if (existing) return existing;
    const exactId = stableId("observed", map.id, frame.fingerprint);
    if (map.screens[exactId] || added.some((item) => item.screenId === exactId)) return exactId;
    if (frame.observation && addedCandidates.length) {
      const resolution = resolveScreenIdentity(frame.observation, addedCandidates);
      if (resolution.kind === "existing") return resolution.match.candidate.id;
    }
    const title = frame.titleGuess.trim().toLocaleLowerCase();
    const named = title && title !== "untitled screen" ? addedByTitle.get(title) : undefined;
    if (named) return named;
    const onMap = title && title !== "untitled screen" ? byTitle.get(title) : undefined;
    if (onMap?.length === 1) return onMap[0]!;
    added.push({ screenId: exactId, frame });
    if (frame.observation) addedCandidates.push({ id: exactId, observation: frame.observation });
    if (title && title !== "untitled screen") addedByTitle.set(title, exactId);
    return exactId;
  });
  const paths: Array<{ fromScreenId: string; toScreenId: string; label: string; at: number }> = [];
  for (let index = 1; index < keys.length; index += 1) {
    const fromScreenId = keys[index - 1]!;
    const toScreenId = keys[index]!;
    if (fromScreenId === toScreenId) continue;
    if (alreadyConnected(map, fromScreenId, toScreenId)) continue;
    if (paths.some((path) => path.fromScreenId === fromScreenId && path.toScreenId === toScreenId))
      continue;
    paths.push({
      fromScreenId,
      toScreenId,
      label: pathLabel(frames[index]!.stepTitle),
      at: frames[index]!.capturedAt,
    });
  }
  return { screens: added, paths };
}

async function variantFor(
  run: PersistedRun,
  screenId: string,
  frame: ObservedRunFrame,
  profile: TargetProfile,
): Promise<{ variant: NewScreen["variant"]; screenshot?: Buffer }> {
  const png = await readFile(join(run.dir, "frames", frame.file)).catch(() => undefined);
  if (!png) return { variant: undefined };
  const screenshot = await persistAuthoringEvidence({
    kind: "screenshot",
    capturedAt: frame.capturedAt,
    data: png,
    mime: "image/png",
  });
  const nodes = await readFrameTreeNodes(run.dir, `frames/${frame.file}`);
  const tree = nodes?.length
    ? await persistAuthoringEvidence({
        kind: "snapshot",
        capturedAt: frame.capturedAt,
        data: JSON.stringify({ nodes }),
        mime: "application/json",
      })
    : undefined;
  return {
    screenshot: png,
    variant: {
      id: stableId("variant", run.id, screenId),
      screenId,
      targetProfile: structuredClone(profile),
      ...(frame.observation ? { observation: structuredClone(frame.observation) } : {}),
      evidenceIds: [screenshot.id, ...(tree ? [tree.id] : [])],
      evidenceUris: [screenshot.uri, ...(tree ? [tree.uri] : [])],
      screenshotUri: screenshot.uri,
      ...(tree
        ? {
            rawAccessibilityTree: {
              id: tree.id,
              uri: tree.uri,
              sha256: tree.sha256!,
              mime: "application/json",
              bytes: tree.bytes!,
              observationId: `run-${run.id}-${screenId}-${frame.capturedAt}`,
              capturedAt: frame.capturedAt,
            },
          }
        : {}),
      captureProvenance: {
        kind: "run",
        runId: run.id,
        capturedAt: frame.capturedAt,
        screenshotEvidenceId: screenshot.id,
        ...(tree ? { accessibilityEvidenceId: tree.id } : {}),
      },
      createdAt: frame.capturedAt,
      updatedAt: frame.capturedAt,
    },
  };
}

/** Add what one finished run discovered to its App Map. Idempotent. */
export async function growAppMapFromRun(run: PersistedRun): Promise<number> {
  const appMapId = appMapIdForRun(run);
  if (!appMapId || !run.projectId || !run.dir) return 0;
  const map = await readAppMap(run.projectId, appMapId);
  if (!map) return 0;
  const observed = await observeRun(run, appMapId);
  if (!observed?.frames.length) return 0;
  const plan = planRunGrowth(map, observed.frames);
  if (!plan.screens.length && !plan.paths.length) return 0;
  const profile = profileForRun(run);
  const namer = registeredNamer ?? nameViaOpenRouter;
  const screens: NewScreen[] = [];
  for (const { screenId, frame } of plan.screens) {
    const { variant, screenshot } = profile
      ? await variantFor(run, screenId, frame, profile)
      : { variant: undefined, screenshot: undefined };
    const named = screenshot
      ? await namer({ screenshot, guess: frame.titleGuess }).catch(() => undefined)
      : undefined;
    screens.push({ screenId, frame, title: named ?? frame.titleGuess, variant });
  }
  let added = 0;
  await mutateStoredAppMap(run.projectId, appMapId, (current) => {
    const scope = {
      organizationId: current.organizationId,
      projectId: current.projectId,
      appMapId: current.id,
    };
    const nextSlot = canvasSlotAllocator(current);
    const joinedAt = Math.max(Date.now(), current.updatedAt);
    const changes: AppMapBatchChange[] = [];
    for (const screen of screens) {
      if (current.screens[screen.screenId]) continue;
      changes.push({
        kind: "screen.add",
        input: {
          screen: {
            ...scope,
            id: screen.screenId,
            title: screen.title,
            identity: { schemaVersion: 1, fingerprint: screen.frame.fingerprint },
            position: nextSlot(),
            variantIds: screen.variant ? [screen.variant.id] : [],
            // When the screen joined the map, so "new since your last visit" works.
            createdAt: joinedAt,
            updatedAt: joinedAt,
          },
          ...(screen.variant ? { variants: [{ ...screen.variant, ...scope }] } : {}),
        },
      });
    }
    const exists = (id: string) =>
      Boolean(current.screens[id]) || screens.some((screen) => screen.screenId === id);
    for (const path of plan.paths) {
      if (!exists(path.fromScreenId) || !exists(path.toScreenId)) continue;
      if (alreadyConnected(current, path.fromScreenId, path.toScreenId)) continue;
      const id = stableId("observed-path", current.id, path.fromScreenId, path.toScreenId);
      if (current.connections[id]) continue;
      const connection: Connection = {
        ...scope,
        id,
        fromScreenId: path.fromScreenId,
        destination: { kind: "screen", screenId: path.toScreenId },
        label: path.label,
        // Draft: Tests never replay it. It records a move a run made.
        state: "draft",
        actions: [{ id: `${id}-observed`, kind: "passive", reason: "observe-only" }],
        createdAt: path.at,
        updatedAt: path.at,
      };
      changes.push({ kind: "connection.create", connection });
    }
    added = changes.length;
    if (!changes.length) return current;
    return commitAppMapChanges(
      current,
      changes,
      undefined,
      {
        expectedRevision: current.revision,
        eventId: `run-grow-${run.id}`.slice(0, 128),
        actorId: "system:runner",
        actorKind: "system",
        at: Math.max(Date.now(), current.updatedAt),
      },
      `Runs found ${screens.length} new ${screens.length === 1 ? "screen" : "screens"}`,
    );
  });
  return added;
}

/**
 * Grow every App Map from runs that finished before this feature existed.
 * Oldest first, so screens found earlier dedupe later runs. Idempotent.
 */
export async function growAppMapsFromPastRuns(): Promise<{ runs: number; changes: number }> {
  const { readdir } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const root = runsRoot();
  let names: string[] = [];
  try {
    names = (await readdir(root)).sort();
  } catch {
    return { runs: 0, changes: 0 };
  }
  let runs = 0;
  let changes = 0;
  for (const name of names) {
    const dir = join(root, name);
    if (!existsSync(join(dir, ".complete"))) continue;
    try {
      const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as PersistedRun;
      if (typeof run.action !== "string" || !appMapIdForRun(run)) continue;
      run.dir = dir;
      runs += 1;
      changes += await growAppMapFromRun(run);
    } catch {
      /* one unreadable or conflicting run never blocks the rest */
    }
  }
  return { runs, changes };
}
