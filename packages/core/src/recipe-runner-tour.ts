/**
 * Depth-0 tour: walk mapped or live child rows, screenshot, return to origin.
 */
import type { Device, SnapshotNode } from "./device.js";
import {
  openApp,
  pressKey,
  pressNamedControl,
  pressPoint,
  rememberedTargetApplication,
  sleep,
  snapshot,
} from "./device.js";
import { captureScreenshot } from "./workspace.js";
import {
  extractTourStops,
  onTourOrigin,
  sameTourScreen,
  tourFallbackOverlap,
  tourScreenSignature,
} from "./tour.js";
import type { RecipeStep } from "./recipes.js";
import type { TestJob } from "./session.js";
import { observeScreenIdentity } from "./screen-identity.js";

async function returnToTourOrigin(
  device: Device,
  origin: ReturnType<typeof tourScreenSignature>,
  log: (line: string) => void,
  stopLabel: string,
): Promise<void> {
  if (!origin.labels.length) {
    try {
      await pressPoint(device, 78, 88);
    } catch {
      await pressPoint(device, 44, 72);
    }
    await sleep(350, device);
    return;
  }
  const attempts: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "key-back", run: () => pressKey(device, "back") },
    {
      name: "label-back",
      run: async () => {
        await pressNamedControl(device, { label: "Back" });
      },
    },
    {
      name: "label-close",
      run: async () => {
        await pressNamedControl(device, { label: "Close" });
      },
    },
    {
      name: "leading-nav",
      run: async () => {
        const nodes = await snapshot(device);
        const frame =
          nodes.find((node) => (node.type ?? node.role)?.toLowerCase() === "application")?.rect ??
          nodes.find((node) => (node.type ?? node.role)?.toLowerCase() === "window")?.rect;
        const x = frame ? frame.x + Math.min(Math.max(frame.width * 0.08, 28), 44) : 44;
        const y = frame ? frame.y + Math.min(Math.max(frame.height * 0.155, 56), 132) : 72;
        await pressPoint(device, x, y);
      },
    },
  ];
  for (const attempt of attempts) {
    try {
      await attempt.run();
    } catch (error) {
      log(
        `tour: ${attempt.name} failed after ${stopLabel} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    await sleep(350, device);
    const current = tourScreenSignature(await snapshot(device));
    if (sameTourScreen(origin, current)) return;
    log(`tour: still on “${current.labels[0] ?? "child"}” after ${attempt.name} from ${stopLabel}`);
  }
  const after = tourScreenSignature(await snapshot(device));
  throw new Error(`tour: could not return from ${stopLabel} (now “${after.labels[0] ?? "child"}”)`);
}

function liveTourOrigin(
  nodes: SnapshotNode[],
  stops: ReturnType<typeof extractTourStops>,
  step: Extract<RecipeStep, { kind: "tour" }>,
): boolean {
  return onTourOrigin({
    liveFingerprint: nodes.length ? observeScreenIdentity(nodes).fingerprint : undefined,
    originFingerprint: step.originFingerprint,
    originAliases: step.originAliases,
    stops,
    fallbackStops: step.fallbackStops,
  });
}

async function readTourSurface(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
): Promise<{ nodes: SnapshotNode[]; stops: ReturnType<typeof extractTourStops> }> {
  let nodes: SnapshotNode[] = [];
  try {
    nodes = await snapshot(device);
  } catch {
    nodes = [];
  }
  return {
    nodes,
    stops: extractTourStops(nodes, {
      maxStops: step.maxStops,
      excludeLanguageRows: step.excludeLanguageRows,
    }),
  };
}

async function runTourPrelude(
  device: Device,
  steps: NonNullable<Extract<RecipeStep, { kind: "tour" }>["preludeSteps"]>,
  log: (line: string) => void,
): Promise<void> {
  for (const step of steps) {
    if (step.kind === "tap" && step.target) {
      log(
        `tour: prelude tap ${step.target.label ?? step.target.identifier ?? step.target.text ?? "control"}`,
      );
      await pressNamedControl(device, {
        ...(step.target.identifier ? { identifier: step.target.identifier } : {}),
        ...(step.target.label ? { label: step.target.label } : {}),
        ...(step.target.text ? { text: step.target.text } : {}),
        ...(step.target.point ? { point: step.target.point } : {}),
      });
    } else if (step.kind === "key") {
      log(`tour: prelude ${step.key}`);
      await pressKey(device, step.key);
    }
    await sleep(350, device);
  }
}

function firstPreludeTargetVisible(
  nodes: SnapshotNode[],
  steps: NonNullable<Extract<RecipeStep, { kind: "tour" }>["preludeSteps"]>,
): boolean {
  const first = steps[0];
  if (first?.kind !== "tap" || !first.target) return false;
  const identifier = first.target.identifier?.trim().toLowerCase();
  const label = (first.target.label ?? first.target.text)?.trim().toLowerCase();
  return nodes.some((node) => {
    if (identifier && node.identifier?.trim().toLowerCase() === identifier) return true;
    const texts = [node.label, node.value]
      .map((value) => value?.trim().toLowerCase())
      .filter(Boolean);
    return Boolean(label && texts.includes(label));
  });
}

export function foregroundApplicationBundle(nodes: SnapshotNode[]): string | undefined {
  const areas = new Map<string, number>();
  for (const node of nodes) {
    const bundleId = node.bundleId?.trim();
    if (
      !bundleId ||
      node.visibleToUser === false ||
      /^(?:com\.android\.systemui|com\.samsung\.android\.)/.test(bundleId)
    )
      continue;
    const area = node.rect ? node.rect.width * node.rect.height : 0;
    areas.set(bundleId, Math.max(areas.get(bundleId) ?? 0, area));
  }
  return [...areas].sort((left, right) => right[1] - left[1])[0]?.[0];
}

async function restoreRememberedApp(
  device: Device,
  nodes: SnapshotNode[],
  log: (line: string) => void,
): Promise<boolean> {
  const remembered = await rememberedTargetApplication();
  if (!remembered) return false;
  const foreground = foregroundApplicationBundle(nodes);
  if (!foreground || foreground === remembered) return false;
  log(`tour: ${foreground} is foreground — reopening ${remembered}`);
  await openApp(device, remembered, { relaunch: false });
  return true;
}

async function tryTourPrelude(
  device: Device,
  surface: Awaited<ReturnType<typeof readTourSurface>>,
  step: Extract<RecipeStep, { kind: "tour" }>,
  log: (line: string) => void,
): Promise<Awaited<ReturnType<typeof readTourSurface>> | null> {
  if (!step.preludeSteps?.length || !firstPreludeTargetVisible(surface.nodes, step.preludeSteps)) {
    return null;
  }
  log(
    step.originTitle
      ? `tour: opening “${step.originTitle}” from the current app screen`
      : "tour: opening the mapped list from the current app screen",
  );
  await runTourPrelude(device, step.preludeSteps, log);
  return await readTourSurface(device, step);
}

async function seekTourOrigin(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  log: (line: string) => void,
): Promise<{ nodes: SnapshotNode[]; stops: ReturnType<typeof extractTourStops> }> {
  let surface = await readTourSurface(device, step);
  if (liveTourOrigin(surface.nodes, surface.stops, step)) return surface;
  const directPrelude = await tryTourPrelude(device, surface, step, log);
  if (directPrelude) {
    surface = directPrelude;
    if (liveTourOrigin(surface.nodes, surface.stops, step)) return surface;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await restoreRememberedApp(device, surface.nodes, log)) {
      surface = await readTourSurface(device, step);
      const restoredPrelude = await tryTourPrelude(device, surface, step, log);
      if (restoredPrelude) surface = restoredPrelude;
      if (liveTourOrigin(surface.nodes, surface.stops, step)) return surface;
    }
    log(
      step.originTitle
        ? `tour: not on “${step.originTitle}” yet — back (${attempt + 1})`
        : step.fallbackStops?.length
          ? `tour: not on the mapped list yet — back (${attempt + 1})`
          : `tour: no rows yet — back (${attempt + 1})`,
    );
    try {
      if (attempt === 2) {
        await pressNamedControl(device, { label: step.originTitle?.trim() || "Settings" });
      } else {
        await pressNamedControl(device, { label: "Back" });
      }
    } catch {
      await pressKey(device, "back");
    }
    await sleep(350, device);
    surface = await readTourSurface(device, step);
    if (liveTourOrigin(surface.nodes, surface.stops, step)) return surface;
    const reachedPrelude = await tryTourPrelude(device, surface, step, log);
    if (reachedPrelude) {
      surface = reachedPrelude;
      if (liveTourOrigin(surface.nodes, surface.stops, step)) return surface;
    }
  }
  if (step.preludeSteps?.length) {
    log(
      step.originTitle
        ? `tour: still not on “${step.originTitle}” — opening the mapped path`
        : "tour: still not on the mapped list — opening the mapped path",
    );
    if (await restoreRememberedApp(device, surface.nodes, log)) {
      surface = await readTourSurface(device, step);
    }
    await runTourPrelude(device, step.preludeSteps, log);
    surface = await readTourSurface(device, step);
  }
  return surface;
}

export async function runTourStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  log: (line: string) => void,
  job?: TestJob,
): Promise<void> {
  const sought = await seekTourOrigin(device, step, log);
  let nodes = sought.nodes;
  let stops = sought.stops;
  const originReached = liveTourOrigin(nodes, stops, step);
  const origin = tourScreenSignature(nodes, {
    excludeLanguageRows: step.excludeLanguageRows,
  });
  if (!stops.length && step.fallbackStops?.length) {
    stops = step.fallbackStops
      .filter((stop) => stop.label.trim())
      .filter(
        (stop) =>
          !step.excludeLanguageRows ||
          !/language|idioma|sprache|langue|言語|语言|語言/i.test(stop.label),
      )
      .slice(0, step.maxStops ?? 24);
    if (stops.length) log(`tour: no live tree — walking ${stops.length} mapped row(s)`);
  }
  if (!originReached && (step.originFingerprint || step.fallbackStops?.length) && nodes.length) {
    throw new Error(
      `tour:not-on-origin — could not reach “${step.originTitle ?? "the mapped list"}”`,
    );
  }
  if (
    step.fallbackStops?.length &&
    stops.length &&
    tourFallbackOverlap(stops, step.fallbackStops) === 0 &&
    !originReached
  ) {
    throw new Error("tour:no-rows — could not reach the mapped list");
  }
  if (!stops.length) {
    if (step.screenshot !== false) {
      await captureScreenshot({
        jobId: job?.id,
        caption: nodes.length ? "tour:no-rows" : "tour:pixels-only",
        device,
      });
    }
    throw new Error(
      nodes.length
        ? "tour:no-rows — no child rows to walk"
        : "tour:no-rows — pixels-only and no mapped fallback stops",
    );
  }
  log(`tour: ${stops.length} stop(s)`);
  for (const stop of stops) {
    log(`tour → ${stop.label}`);
    await pressNamedControl(device, {
      ...(stop.identifier ? { identifier: stop.identifier } : {}),
      label: stop.label,
      ...(stop.point ? { point: stop.point } : {}),
    });
    if (step.screenshot !== false) {
      await captureScreenshot({
        jobId: job?.id,
        caption: `tour:${stop.label}`,
        device,
      });
    }
    await returnToTourOrigin(device, origin, log, stop.label);
  }
}
