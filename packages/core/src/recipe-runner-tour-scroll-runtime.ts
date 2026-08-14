import type { Device, SnapshotNode } from "./device.js";
import { scrollDown, scrollUp, sleep, snapshot } from "./device.js";
import type { RecipeStep } from "./recipes.js";
import { extractTourStops, type TourStop } from "./tour.js";
import {
  mergeTourViewportRows,
  tourViewportKey,
  visibleTourRow,
} from "./recipe-runner-tour-scroll.js";

export type TourSurface = { nodes: SnapshotNode[]; stops: TourStop[] };

export async function readCompleteTourSurface(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
): Promise<TourSurface> {
  let nodes: SnapshotNode[] = [];
  try {
    nodes = await snapshot(device);
  } catch {
    nodes = [];
  }
  return {
    nodes,
    stops: extractTourStops(nodes, {
      maxStops: Math.max(64, step.maxStops ?? 0),
      excludeLanguageRows: step.excludeLanguageRows,
    }),
  };
}

function semanticScrollSearch(step: Extract<RecipeStep, { kind: "tour" }>): {
  maxScrolls: number;
  amount: number;
} {
  const expectedRows = Math.max(step.landmarkStops?.length ?? 0, step.fallbackStops?.length ?? 0);
  return {
    maxScrolls: step.scrollSearch?.maxScrolls ?? Math.min(48, Math.max(8, expectedRows + 4)),
    amount: step.scrollSearch?.amount ?? 0.55,
  };
}

async function scrollTourSurface(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  direction: "up" | "down",
  amount: number,
): Promise<TourSurface> {
  if (direction === "up") await scrollUp(device, amount);
  else await scrollDown(device, amount);
  await sleep(250, device);
  return readCompleteTourSurface(device, step);
}

/** Move to the semantic beginning of a list. Repeating the same ordered live
 * row keys proves the edge; no recorded pixel offset is involved. */
async function normalizeTourToStart(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  surface: TourSurface,
  log: (line: string) => void,
): Promise<TourSurface> {
  const { maxScrolls, amount } = semanticScrollSearch(step);
  let current = surface;
  for (let attempt = 0; attempt < maxScrolls; attempt++) {
    let next: TourSurface;
    try {
      next = await scrollTourSurface(device, step, "up", amount);
    } catch (error) {
      if (attempt === 0) {
        log(
          `tour: semantic scroll search unavailable (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      return current;
    }
    if (tourViewportKey(next.stops) === tourViewportKey(current.stops)) return next;
    current = next;
  }
  return current;
}

/** Scan the complete parent list through overlapping live viewports. Row
 * labels and identifiers are collected in order; point geometry is discarded
 * as soon as a row leaves the viewport. */
export async function collectSemanticTourRows(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  surface: TourSurface,
  log: (line: string) => void,
): Promise<{ rows: TourStop[]; start: TourSurface; viewports: number }> {
  const { maxScrolls, amount } = semanticScrollSearch(step);
  const start = await normalizeTourToStart(device, step, surface, log);
  let current = start;
  let rows = [...current.stops];
  let viewports = 1;
  const seen = new Set([tourViewportKey(current.stops)]);
  for (let attempt = 0; attempt < maxScrolls; attempt++) {
    let next: TourSurface;
    try {
      next = await scrollTourSurface(device, step, "down", amount);
    } catch {
      break;
    }
    const key = tourViewportKey(next.stops);
    if (!key || seen.has(key)) break;
    seen.add(key);
    rows = mergeTourViewportRows(rows, next.stops);
    current = next;
    viewports++;
  }
  const restoredStart = await normalizeTourToStart(device, step, current, log);
  log(`tour: indexed ${rows.length} semantic row(s) across ${viewports} viewport(s)`);
  return { rows, start: restoredStart, viewports };
}

export async function seekSemanticTourRow(
  device: Device,
  step: Extract<RecipeStep, { kind: "tour" }>,
  target: TourStop,
  initial: TourSurface,
  log: (line: string) => void,
): Promise<{ surface: TourSurface; stop: TourStop }> {
  const { maxScrolls, amount } = semanticScrollSearch(step);
  const scanDown = async (
    start: TourSurface,
  ): Promise<{ surface: TourSurface; stop: TourStop } | undefined> => {
    let current = start;
    let match = visibleTourRow(current.stops, target);
    if (match) return { surface: current, stop: match };
    const seen = new Set([tourViewportKey(current.stops)]);
    for (let attempt = 0; attempt < maxScrolls; attempt++) {
      try {
        current = await scrollTourSurface(device, step, "down", amount);
      } catch {
        return undefined;
      }
      const key = tourViewportKey(current.stops);
      if (!key || seen.has(key)) return undefined;
      seen.add(key);
      match = visibleTourRow(current.stops, target);
      if (match) {
        if (attempt > 0) log(`tour: found “${target.label}” after ${attempt + 1} semantic scrolls`);
        return { surface: current, stop: match };
      }
    }
    return undefined;
  };

  const nearby = await scanDown(initial);
  if (nearby) return nearby;
  const start = await normalizeTourToStart(device, step, initial, log);
  const fromStart = await scanDown(start);
  if (fromStart) return fromStart;
  throw new Error(`tour:row-not-found — could not find live row “${target.label}”`);
}
