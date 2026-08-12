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
  scrollDown,
  scrollUp,
  sleep,
  swipeGesture,
  snapshot,
} from "./device.js";
import { captureScreenshot } from "./workspace.js";
import {
  extractTourStops,
  onTourOrigin,
  tourFallbackOverlap,
  tourOriginFingerprintMatch,
} from "./tour.js";
import type { TourStop } from "./tour.js";
import type { RecipeStep } from "./recipes.js";
import type { TestJob } from "./session.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";
import { nodeMatchesTarget } from "./recipe-target-match.js";

async function returnToTourOrigin(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  log: (line: string) => void,
  stopLabel: string,
  rightToLeft = false,
  job?: TestJob,
): Promise<void> {
  if (!step.fallbackStops?.length && !step.originFingerprint) {
    try {
      await pressPoint(device, 78, 88);
    } catch {
      await pressPoint(device, 44, 72);
    }
    await sleep(350, device);
    return;
  }
  const attempts: Array<{ name: string; run: () => Promise<void> }> = [
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
    // Prefer the page's semantic/system Back control. On Android this returns
    // a Settings child to the same scrolled list, whereas a hardware Back can
    // dismiss the whole settings surface or an intervening sheet.
    { name: "key-back", run: () => pressKey(device, "back") },
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
    const surface = await readTourSurface(device, step);
    if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) return;
    if (await restoreTourViewport(device, step, log, rightToLeft, job)) return;
    log(
      `tour: still on “${surface.stops[0]?.label ?? "child"}” after ${attempt.name} from ${stopLabel}`,
    );
  }
  const after = await readTourSurface(device, step);
  throw new Error(
    `tour: could not return from ${stopLabel} (now “${after.stops[0]?.label ?? "child"}”)`,
  );
}

/**
 * Android Settings child pages can return to the right parent list but reset
 * its scroll offset. Recover the recorded viewport before trying another
 * back action; otherwise an exact tour can tap a correct label in the wrong
 * scroll state on its next row.
 */
async function restoreTourViewport(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  log: (line: string) => void,
  rightToLeft: boolean,
  job?: TestJob,
): Promise<boolean> {
  if (!step.fallbackStops?.length) return false;
  // Do not require an overlapping row before scanning. Several Android
  // settings surfaces reset all the way to a profile/header block after a
  // child returns, so the intended rows are temporarily all off-screen.
  // This is only a bounded, non-mutating scroll recovery; a later exact
  // origin check still decides whether it is safe to continue.
  const moves: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "down", run: () => scrollDown(device, 0.6) },
    { name: "down", run: () => scrollDown(device, 0.6) },
    { name: "up", run: () => scrollUp(device, 0.6) },
    { name: "up", run: () => scrollUp(device, 0.6) },
  ];
  for (const move of moves) {
    await move.run();
    await sleep(350, device);
    const surface = await readTourSurface(device, step);
    if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) {
      log(
        `tour: restored mapped scroll position (${move.name}) after ${step.originTitle ?? "child"}`,
      );
      return true;
    }
  }
  return false;
}

function liveTourOrigin(
  nodes: SnapshotNode[],
  stops: ReturnType<typeof extractTourStops>,
  step: Extract<RecipeStep, { kind: "tour" }>,
  rightToLeft = false,
  job?: TestJob,
): boolean {
  const liveObservation = nodes.length ? observeScreenIdentity(nodes) : undefined;
  if (
    isLocalizedJob(job) &&
    liveObservation &&
    step.originObservations?.some((origin) => {
      const comparison = compareScreenIdentity(liveObservation, origin);
      const stableIdentifiers = comparison.signals.find(
        (signal) => signal.kind === "stable-identifier-overlap" && signal.impact === "positive",
      )?.strength;
      const structure = comparison.signals.find(
        (signal) => signal.kind === "structural-overlap" && signal.impact === "positive",
      )?.strength;
      // Locale changes intentionally invalidate English labels. Only accept an
      // origin when its non-localized native identity and visible structure
      // independently prove it is the same surface.
      return (stableIdentifiers ?? 0) >= 0.98 && (structure ?? 0) >= 0.95;
    })
  ) {
    return true;
  }
  return onTourOrigin({
    liveFingerprint: liveObservation?.fingerprint,
    originFingerprint: step.originFingerprint,
    originAliases: step.originAliases,
    stops,
    fallbackStops: step.fallbackStops,
    ...(rightToLeft && step.mappedStopsOnly ? { minimumFallbackOverlap: 1 } : {}),
  });
}

function isRightToLeftJob(job?: TestJob): boolean {
  const locale = (job?.resolvedInputs?.language ?? job?.resolvedInputs?.locale ?? "")
    .trim()
    .toLowerCase();
  return /^(?:ar|fa|he|iw|ps|ur)(?:-|$)/.test(locale);
}

function isLocalizedJob(job?: TestJob): boolean {
  const locale = (job?.resolvedInputs?.language ?? job?.resolvedInputs?.locale ?? "")
    .trim()
    .toLowerCase();
  return Boolean(locale && !/^en(?:-|$)/.test(locale));
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
    try {
      if (step.when) {
        const nodes = await snapshot(device);
        const present = conditionalPreludeTargetPresent(nodes, step.when);
        const shouldRun = step.when.condition === "present" ? present : !present;
        if (!shouldRun) {
          log(
            `tour: conditional prelude ${step.kind} skipped — ${describePreludeTarget(step.when.target)} is ${present ? "present" : "absent"}`,
          );
          continue;
        }
      }
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
      } else if (step.kind === "swipe") {
        log("tour: prelude swipe");
        await swipeGesture(device, step.from, step.to, step.durationMs);
      } else if (step.kind === "scroll") {
        log(`tour: prelude scroll ${step.direction}`);
        if (step.direction === "down") await scrollDown(device, step.amount);
        else await scrollUp(device, step.amount);
      }
      await sleep(350, device);
    } catch (error) {
      if (!step.optional) throw error;
      log(
        `tour: optional prelude ${step.kind} skipped — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function describePreludeTarget(target: NonNullable<RecipeStep["when"]>["target"]): string {
  return target.label ?? target.identifier ?? target.text ?? target.ref ?? "control";
}

function conditionalPreludeTargetPresent(
  nodes: SnapshotNode[],
  condition: NonNullable<RecipeStep["when"]>,
): boolean {
  const region = condition.region;
  if (!region) return nodes.some((node) => nodeMatchesTarget(node, condition.target));
  const viewport =
    nodes.find((node) => (node.type ?? node.role)?.toLowerCase() === "application")?.rect ??
    nodes.find((node) => (node.type ?? node.role)?.toLowerCase() === "window")?.rect;
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("tour: conditional prelude could not read viewport bounds");
  }
  return nodes.some((node) => {
    if (!nodeMatchesTarget(node, condition.target) || !node.rect) return false;
    const x = (node.rect.x + node.rect.width / 2 - viewport.x) / viewport.width;
    const y = (node.rect.y + node.rect.height / 2 - viewport.y) / viewport.height;
    return (
      (region.minX === undefined || x >= region.minX) &&
      (region.maxX === undefined || x <= region.maxX) &&
      (region.minY === undefined || y >= region.minY) &&
      (region.maxY === undefined || y <= region.maxY)
    );
  });
}

function firstPreludeTargetVisible(
  nodes: SnapshotNode[],
  step: Extract<RecipeStep, { kind: "tour" }>,
): boolean {
  const steps = step.preludeSteps;
  if (!steps?.length) return false;
  if (
    step.preludeStartFingerprint &&
    !tourOriginFingerprintMatch(
      nodes.length ? observeScreenIdentity(nodes).fingerprint : undefined,
      step.preludeStartFingerprint,
      step.preludeStartAliases,
    )
  ) {
    return false;
  }
  const first = steps[0];
  // A mapped scroll/swipe is the route to a known scroll checkpoint. Unlike a
  // tap it has no label to discover, so it should be attempted immediately on
  // the current app surface rather than spending three Back retries first.
  if (first?.kind === "swipe" || first?.kind === "scroll") return true;
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

/** Preserve the saved screen order and fill individual accessibility gaps with
 * mapped points. A partially inspectable screen must not silently shrink an
 * exact coverage test. */
export function mergeMappedTourStops(
  live: TourStop[],
  mapped: TourStop[],
  options: { alignByOrder?: boolean } = {},
): TourStop[] {
  const labelMatches = tourFallbackOverlap(live, mapped);
  if (
    options.alignByOrder &&
    live.length === mapped.length &&
    labelMatches < Math.min(2, mapped.length)
  ) {
    return mapped.map((mappedStop, index) => ({
      ...live[index]!,
      // Keep canonical map labels in evidence while using the current
      // localized row's actual hit point.
      label: mappedStop.label,
      ...(mappedStop.capture === undefined ? {} : { capture: mappedStop.capture }),
    }));
  }
  const unused = new Set(live.map((_, index) => index));
  return mapped.map((fallback) => {
    const fallbackLabel = fallback.label.trim().toLocaleLowerCase();
    const fallbackIdentifier = fallback.identifier?.trim().toLocaleLowerCase();
    const matchIndex = live.findIndex((candidate, index) => {
      if (!unused.has(index)) return false;
      if (
        fallbackIdentifier &&
        candidate.identifier?.trim().toLocaleLowerCase() === fallbackIdentifier
      ) {
        return true;
      }
      return candidate.label.trim().toLocaleLowerCase() === fallbackLabel;
    });
    if (matchIndex < 0) return fallback;
    unused.delete(matchIndex);
    return {
      ...live[matchIndex]!,
      ...(fallback.capture === undefined ? {} : { capture: fallback.capture }),
    };
  });
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
  if (!step.preludeSteps?.length || !firstPreludeTargetVisible(surface.nodes, step)) {
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
  rightToLeft = false,
  job?: TestJob,
): Promise<{ nodes: SnapshotNode[]; stops: ReturnType<typeof extractTourStops> }> {
  let surface = await readTourSurface(device, step);
  if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) return surface;
  const directPrelude = await tryTourPrelude(device, surface, step, log);
  if (directPrelude) {
    surface = directPrelude;
    if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) return surface;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await restoreRememberedApp(device, surface.nodes, log)) {
      surface = await readTourSurface(device, step);
      const restoredPrelude = await tryTourPrelude(device, surface, step, log);
      if (restoredPrelude) surface = restoredPrelude;
      if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) return surface;
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
    if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) return surface;
    const reachedPrelude = await tryTourPrelude(device, surface, step, log);
    if (reachedPrelude) {
      surface = reachedPrelude;
      if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) return surface;
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
    if (firstPreludeTargetVisible(surface.nodes, step)) {
      await runTourPrelude(device, step.preludeSteps, log);
      surface = await readTourSurface(device, step);
    } else {
      log("tour: mapped prelude start is not verified; refusing to replay it off-origin");
    }
  }
  return surface;
}

export async function runTourStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  log: (line: string) => void,
  job?: TestJob,
): Promise<void> {
  const rightToLeft = isRightToLeftJob(job);
  const sought = await seekTourOrigin(device, step, log, rightToLeft, job);
  let nodes = sought.nodes;
  let stops = sought.stops;
  const originReached = liveTourOrigin(nodes, stops, step, rightToLeft, job);
  if (originReached && step.captureOrigin && step.screenshot !== false) {
    await captureScreenshot({
      jobId: job?.id,
      caption: `screen:${step.originTitle ?? "tour origin"}`,
      device,
    });
  }
  if (originReached && step.mappedStopsOnly && !step.fallbackStops?.length) return;
  if (step.mappedStopsOnly && step.fallbackStops?.length && stops.length) {
    const liveStops = stops;
    const alignedLocalizedRows = isLocalizedJob(job) && stops.length === step.fallbackStops.length;
    const merged = mergeMappedTourStops(stops, step.fallbackStops, {
      alignByOrder: isLocalizedJob(job),
    });
    const fallbackCount = alignedLocalizedRows
      ? 0
      : step.fallbackStops.filter(
          (fallback) =>
            !liveStops.some(
              (live) =>
                live.label.trim().toLocaleLowerCase() ===
                  fallback.label.trim().toLocaleLowerCase() ||
                (Boolean(fallback.identifier) && live.identifier === fallback.identifier),
            ),
        ).length;
    if (fallbackCount) {
      log(`tour: using mapped point fallback for ${fallbackCount} missing row(s)`);
    }
    // An exact coverage tour must never turn a missing semantic row into a
    // stale coordinate tap. That can capture Kids Mode under a label such as
    // “Customize Grok” and make a run look healthy while corrupting evidence.
    // Localized lists are intentionally paired by their visible order above.
    if (!alignedLocalizedRows && fallbackCount) {
      const liveLabels = new Set(
        liveStops.map((candidate) => candidate.label.trim().toLocaleLowerCase()),
      );
      const missing = step.fallbackStops
        .filter((candidate) => !liveLabels.has(candidate.label.trim().toLocaleLowerCase()))
        .map((candidate) => candidate.label)
        .filter((label, index, labels) => labels.indexOf(label) === index);
      if (missing.length) {
        throw new Error(
          `tour: mapped row(s) are not visible on “${step.originTitle ?? "the mapped list"}”: ${missing.join(", ")}`,
        );
      }
    }
    stops = merged;
  }
  if (!stops.length && step.fallbackStops?.length) {
    stops = step.fallbackStops
      .filter((stop) => stop.label.trim())
      .filter(
        (stop) =>
          !step.excludeLanguageRows ||
          !/language|idioma|sprache|langue|lingua|língua|لغة|言語|语言|語言/i.test(stop.label),
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
    await sleep(350, device);
    if (step.screenshot !== false && stop.capture !== false) {
      await captureScreenshot({
        jobId: job?.id,
        caption: `tour:${stop.label}`,
        device,
      });
    }
    await returnToTourOrigin(device, step, log, stop.label, rightToLeft, job);
  }
}
