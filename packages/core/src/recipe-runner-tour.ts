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
import type { RecipeStep } from "./recipes.js";
import type { TestJob } from "./session.js";
import {
  compareScreenIdentity,
  localeNeutralStructureSignature,
  observeScreenIdentity,
} from "./screen-identity.js";
import { nodeMatchesTarget } from "./recipe-target-match.js";

import {
  foregroundApplicationBundle,
  leadingNavigationPoint,
  localizedLeadingBackPoint,
  mappedTourRowsNeedRefresh,
  mappedTourStopLandmarkPairs,
  mappedTourStopPointPairs,
  mayRestoreTourViewportAfterReturn,
  mergeMappedTourStops,
  tourMappedRowRecoveryMoves,
  tourViewportRecoveryMoves,
} from "./recipe-runner-tour-matching.js";
export {
  foregroundApplicationBundle,
  leadingNavigationPoint,
  localizedLeadingBackPoint,
  mappedTourRowsNeedRefresh,
  mappedTourStopLandmarkPairs,
  mappedTourStopPointPairs,
  mayRestoreTourViewportAfterReturn,
  mergeMappedTourStops,
  missingRequiredTourStops,
  tourMappedRowRecoveryMoves,
  tourViewportRecoveryMoves,
} from "./recipe-runner-tour-matching.js";

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
  const childNodes = await snapshot(device).catch(() => [] as SnapshotNode[]);
  // The Back chevron is often a generic, non-hittable accessibility node on
  // Android. Its labelled bounds are still reliable, irrespective of the
  // current locale, so prefer that observed point before trying selectors.
  // This avoids paying for a known-stale Grok identifier on every child page.
  const observedBackPoint = localizedLeadingBackPoint(childNodes, rightToLeft);
  const hasGrokBackIdentifier = childNodes.some((node) => node.identifier === "grok-arrow-left");
  const hasBackLabel = childNodes.some((node) => node.label?.trim() === "Back");
  const hasCloseLabel = childNodes.some((node) => node.label?.trim() === "Close");
  const attempts: Array<{
    name: string;
    verifiedAppBack?: boolean;
    run: () => Promise<void>;
  }> = [
    ...(observedBackPoint
      ? [
          {
            name: "observed-app-back",
            verifiedAppBack: true,
            run: () => pressPoint(device, observedBackPoint.x, observedBackPoint.y),
          },
        ]
      : []),
    // Some Grok builds expose a stable chevron identifier. Use it when
    // present, but do not rely on it: other builds expose only a localized
    // accessibility label on the leading arrow.
    ...(hasGrokBackIdentifier
      ? [
          {
            name: "grok-back",
            run: async () => {
              await pressNamedControl(device, { identifier: "grok-arrow-left" });
            },
          },
        ]
      : []),
    // A Back label without bounds is still worth trying semantically. When
    // the bounds exist, observed-app-back above is both faster and safer.
    ...(!observedBackPoint && hasBackLabel
      ? [
          {
            name: "label-back",
            run: async () => {
              await pressNamedControl(device, { label: "Back" });
            },
          },
        ]
      : []),
    ...(hasCloseLabel
      ? [
          {
            name: "label-close",
            run: async () => {
              await pressNamedControl(device, { label: "Close" });
            },
          },
        ]
      : []),
    // Prefer the page's semantic/system Back control. On Android this returns
    // a Settings child to the same scrolled list, whereas a hardware Back can
    // dismiss the whole settings surface or an intervening sheet.
    { name: "key-back", run: () => pressKey(device, "back") },
    ...(!isLocalizedJob(job)
      ? [
          {
            name: "leading-nav",
            run: async () => {
              const nodes = await snapshot(device);
              const frame =
                nodes.find((node) => (node.type ?? node.role)?.toLowerCase() === "application")
                  ?.rect ??
                nodes.find((node) => (node.type ?? node.role)?.toLowerCase() === "window")?.rect;
              const point = leadingNavigationPoint(frame, rightToLeft);
              await pressPoint(device, point.x, point.y);
            },
          },
        ]
      : []),
  ];
  for (const attempt of attempts) {
    let interactionSucceeded = false;
    try {
      await attempt.run();
      interactionSucceeded = true;
    } catch (error) {
      log(
        `tour: ${attempt.name} failed after ${stopLabel} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    await sleep(350, device);
    const surface = await readTourSurface(device, step);
    if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) return;
    if (
      mayRestoreTourViewportAfterReturn({
        interactionSucceeded,
        localized: isLocalizedJob(job),
        verifiedAppBack: attempt.verifiedAppBack,
      }) &&
      (await restoreTourViewport(device, step, log, rightToLeft, job))
    ) {
      return;
    }
    if (isLocalizedJob(job) && interactionSucceeded) {
      log(`tour: ${attempt.name} did not verify the translated parent; refusing to scroll a child`);
    }
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
  const moves = tourViewportRecoveryMoves().map((name) => ({
    name,
    run: () => (name === "up" ? scrollUp(device, 0.6) : scrollDown(device, 0.6)),
  }));
  for (const move of moves) {
    try {
      await move.run();
    } catch (error) {
      // Recovery is an enhancement over the semantic Back/prelude path. A
      // target without scroll support (or a test double without that optional
      // capability) must continue through the normal hierarchy recovery,
      // rather than failing before it gets a chance to press Back.
      log(
        `tour: cannot normalize scroll position (${error instanceof Error ? error.message : String(error)})`,
      );
      return false;
    }
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
  if (isLocalizedJob(job)) {
    if (!liveObservation) return false;
    const structureSignature = localeNeutralStructureSignature(liveObservation);
    return Boolean(
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
        return (
          ((stableIdentifiers ?? 0) >= 0.98 && (structure ?? 0) >= 0.95) ||
          (structureSignature !== undefined &&
            structureSignature === localeNeutralStructureSignature(origin))
        );
      }),
    );
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

/** Recover a known scroll checkpoint before declaring a recorded English row
 * missing. Locale runs use their own order/point matching, so this deliberately
 * works only with the same semantic labels used to author the map. */
async function recoverMappedTourRows(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  surface: Awaited<ReturnType<typeof readTourSurface>>,
  log: (line: string) => void,
): Promise<Awaited<ReturnType<typeof readTourSurface>>> {
  if (
    !step.fallbackStops?.length ||
    !mappedTourRowsNeedRefresh(surface.stops, step.fallbackStops)
  ) {
    return surface;
  }
  // Compose can publish the page pixels a frame before its row semantics. A
  // one-off truncated AX read must not turn an obviously visible card into a
  // failed tour (or trigger needless scrolling on a non-scrolling page).
  await sleep(400, device);
  let current = await readTourSurface(device, step);
  if (!mappedTourRowsNeedRefresh(current.stops, step.fallbackStops)) {
    log("tour: refreshed mapped rows after the screen settled");
    return current;
  }
  for (const direction of tourMappedRowRecoveryMoves()) {
    try {
      if (direction === "up") await scrollUp(device, 0.6);
      else await scrollDown(device, 0.6);
    } catch (error) {
      log(
        `tour: cannot seek mapped rows (${error instanceof Error ? error.message : String(error)})`,
      );
      return current;
    }
    await sleep(350, device);
    current = await readTourSurface(device, step);
    if (!mappedTourRowsNeedRefresh(current.stops, step.fallbackStops)) {
      log(`tour: restored mapped row viewport (${direction})`);
      return current;
    }
  }
  return current;
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
  // We may already be on the correct parent list but at a different scroll
  // checkpoint. Normalize that list before pressing Back: Back is for moving
  // up the hierarchy, not a substitute for finding a row that is merely off
  // screen.
  if (await restoreTourViewport(device, step, log, rightToLeft, job)) {
    return await readTourSurface(device, step);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await restoreRememberedApp(device, surface.nodes, log)) {
      surface = await readTourSurface(device, step);
      const restoredPrelude = await tryTourPrelude(device, surface, step, log);
      if (restoredPrelude) surface = restoredPrelude;
      if (liveTourOrigin(surface.nodes, surface.stops, step, rightToLeft, job)) return surface;
    }
    if (await restoreTourViewport(device, step, log, rightToLeft, job)) {
      return await readTourSurface(device, step);
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
  // A setup Flow reaches this exact root through verified expect-screen steps.
  // Do not immediately run the generic back-seeking loop again: localized
  // labels can make the English map identity appear unmatched and the loop can
  // leave the just-verified list before the tour starts.
  const sought = step.originVerifiedBySetup
    ? await readTourSurface(device, step)
    : await seekTourOrigin(device, step, log, rightToLeft, job);
  let nodes = sought.nodes;
  let stops = sought.stops;
  // A setup Flow is compiled only when it terminates at this exact root, and
  // its own expect-screen verification has already completed. This is the
  // one safe point at which localized labels may not yet overlap the saved
  // English identity. Once we leave the root, normal live identity checks
  // remain mandatory for every return from a child page.
  const originReached =
    step.originVerifiedBySetup || liveTourOrigin(nodes, stops, step, rightToLeft, job);
  // A setup Flow verifies the parent screen, but recorded depth-0 tours also
  // need their selected rows in the current viewport. On English runs we can
  // prove that semantically and repair a shifted scroll checkpoint before
  // capturing or tapping. Translated runs use live-order/point pairing below.
  if (originReached && step.mappedStopsOnly && step.fallbackStops?.length && !isLocalizedJob(job)) {
    const recovered = await recoverMappedTourRows(device, step, { nodes, stops }, log);
    nodes = recovered.nodes;
    stops = recovered.stops;
  }
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
    const landmarkPairs =
      isLocalizedJob(job) && step.landmarkStops?.length
        ? mappedTourStopLandmarkPairs(stops, step.fallbackStops, step.landmarkStops)
        : undefined;
    const alignedLocalizedRows =
      isLocalizedJob(job) &&
      (Boolean(landmarkPairs) ||
        Boolean(mappedTourStopPointPairs(stops, step.fallbackStops)) ||
        stops.length === step.fallbackStops.length);
    const merged = mergeMappedTourStops(stops, step.fallbackStops, {
      alignByOrder: isLocalizedJob(job),
      alignByPoint: isLocalizedJob(job),
      ...(isLocalizedJob(job) && step.landmarkStops?.length
        ? { landmarkStops: step.landmarkStops }
        : {}),
    });
    const missingFallbackStops = alignedLocalizedRows
      ? []
      : step.fallbackStops.filter(
          (fallback) =>
            !liveStops.some(
              (live) =>
                live.label.trim().toLocaleLowerCase() ===
                  fallback.label.trim().toLocaleLowerCase() ||
                (Boolean(fallback.identifier) && live.identifier === fallback.identifier),
            ),
        );
    const missingRequiredStops = missingFallbackStops.filter((stop) => !stop.optional);
    const missingOptionalStops = missingFallbackStops.filter((stop) => stop.optional);
    if (missingOptionalStops.length) {
      log(
        `tour: optional row(s) unavailable in this state — ${missingOptionalStops.map((stop) => stop.label).join(", ")}`,
      );
    }
    // An exact coverage tour must never turn a missing semantic row into a
    // stale coordinate tap. That can capture Kids Mode under a label such as
    // “Customize Grok” and make a run look healthy while corrupting evidence.
    // Localized lists are intentionally paired by their visible order above.
    if (!alignedLocalizedRows && missingRequiredStops.length) {
      const liveLabels = new Set(
        liveStops.map((candidate) => candidate.label.trim().toLocaleLowerCase()),
      );
      const missing = missingRequiredStops
        .filter((candidate) => !liveLabels.has(candidate.label.trim().toLocaleLowerCase()))
        .map((candidate) => candidate.label)
        .filter((label, index, labels) => labels.indexOf(label) === index);
      if (missing.length) {
        throw new Error(
          `tour: mapped row(s) are not visible on “${step.originTitle ?? "the mapped list"}”: ${missing.join(", ")}`,
        );
      }
    }
    stops = merged.filter((_, index) => {
      const recorded = step.fallbackStops![index]!;
      return !recorded.optional || !missingFallbackStops.includes(recorded);
    });
  }
  if (!stops.length && step.fallbackStops?.length) {
    stops = step.fallbackStops
      .filter((stop) => !stop.optional)
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
  for (const [index, stop] of stops.entries()) {
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
    if (index < stops.length - 1 || step.returnAfterLast !== false) {
      await returnToTourOrigin(device, step, log, stop.label, rightToLeft, job);
    } else {
      log(`tour: completed on final child “${stop.label}” — next setup owns recovery`);
    }
  }
}
