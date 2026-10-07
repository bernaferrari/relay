import * as z from "zod/v4";
import type { SnapshotNode } from "./device.js";
import type { LiveIosRunnerCommandPost } from "./ios-runner-listener-command.js";
import type { LiveIosRunnerListener } from "./ios-runner-listener.js";
import { IosRunnerReadError } from "./ios-runner-read-error.js";
import {
  IOS_BOUNDED_HOME_CHROME_IDENTIFIERS,
  IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS,
  IOS_BOUNDED_ATTACH_MENU_IDENTIFIERS,
  IOS_BOUNDED_HOME_CHROME_LABELS,
  IOS_BOUNDED_CHROME_LABELS,
  IOS_CHROME_QUERY_TIMEOUT_MS,
  chromeValuesToQuery,
} from "./ios-snapshot-chrome.js";

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
const nodeSchema = z.looseObject({
  type: z.string().optional(),
  label: z.string().optional(),
  identifier: z.string().optional(),
  value: z.string().optional(),
  hittable: z.literal(true),
  rect: rectSchema,
  bundleId: z.string().optional(),
  logicalCoordinates: z.boolean().optional(),
});
const resultSchema = z
  .object({
    queryIndex: z.number().int().nonnegative(),
    selectorKey: z.enum(["id", "label"]),
    selectorValue: z.string(),
    ok: z.boolean(),
    found: z.boolean().optional(),
    rawMatchCount: z.number().int().nonnegative(),
    hittableMatchCount: z.number().int().nonnegative(),
    nodes: z.array(nodeSchema),
    error: z.object({ code: z.string(), message: z.string().optional() }).optional(),
  })
  .refine(
    (row) =>
      row.rawMatchCount >= row.hittableMatchCount &&
      (row.ok
        ? row.error === undefined &&
          (row.found === true
            ? row.hittableMatchCount === 1 && row.nodes.length === 1
            : row.found === false && row.hittableMatchCount === 0 && row.nodes.length === 0)
        : row.error?.code === "AMBIGUOUS_MATCH" &&
          row.hittableMatchCount >= 2 &&
          row.nodes.length === 0 &&
          row.found === undefined),
  );
const receiptSchema = z.object({
  version: z.literal(1),
  source: z.literal("xcui-selector-catalog"),
  coverage: z.literal("requested-selectors"),
  appBundleId: z.string(),
  appStateBefore: z.literal("runningForeground"),
  appStateAfter: z.literal("runningForeground"),
  coordinateSpace: z.literal("application-logical"),
  geometrySource: z.literal("xcui-window-frame"),
  bounds: rectSchema,
  results: z.array(resultSchema).max(64),
  systemSurface: z.unknown().optional(),
});

type Query = { selectorKey: "id" | "label"; selectorValue: string };

/** One catalog acquisition; adaptive groups are projected from the same native predicate census. */
export async function queryIosSnapshotCatalogViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: {
    appBundleId?: string;
    includeIdentifiers?: readonly string[];
    includeLabels?: readonly string[];
    separateRequestedSelectorEvidence?: boolean;
  },
  timeoutMs: number,
): Promise<{ nodes: SnapshotNode[]; bounds: z.infer<typeof rectSchema> }> {
  const appBundleId = input.appBundleId;
  if (!appBundleId) throw new Error("iOS selector catalog requires the exact target application");
  const extraIds = input.includeIdentifiers ?? [];
  const attachIds = new Set<string>(IOS_BOUNDED_ATTACH_MENU_IDENTIFIERS);
  const sidebarIds = new Set<string>(IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS);
  const home = chromeValuesToQuery(
    IOS_BOUNDED_HOME_CHROME_IDENTIFIERS,
    extraIds.filter((value) => !attachIds.has(value.trim()) && !sidebarIds.has(value.trim())),
  );
  const sidebar = chromeValuesToQuery(
    IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS,
    extraIds.filter((value) => sidebarIds.has(value.trim())),
  );
  const attach = chromeValuesToQuery(
    [],
    extraIds.filter((value) => attachIds.has(value.trim())),
  );
  const labels = chromeValuesToQuery(
    [...IOS_BOUNDED_HOME_CHROME_LABELS, ...IOS_BOUNDED_CHROME_LABELS],
    input.includeLabels,
  );
  const queries: Query[] = [
    ...[...home, ...sidebar, ...attach].map((selectorValue): Query => ({
      selectorKey: "id",
      selectorValue,
    })),
    ...labels.map((selectorValue): Query => ({ selectorKey: "label", selectorValue })),
  ];
  const budget = Math.min(timeoutMs, IOS_CHROME_QUERY_TIMEOUT_MS);
  const result = await post(
    listener,
    {
      command: "querySelectorCatalog",
      appBundleId,
      selectorQueries: queries,
      timeoutMs: budget,
    },
    budget,
  );
  if (result.ok !== true) {
    const error = typeof result.error === "object" ? result.error : undefined;
    const unsupported = error?.code === "UNSUPPORTED_OPERATION" || error?.code === "INVALID_ARGS";
    throw new IosRunnerReadError(
      result,
      unsupported
        ? "The installed iOS runner does not support selector catalog acquisition. Rebuild and recover the runner before retrying inspection."
        : `iOS selector catalog failed: ${error?.message ?? (typeof result.error === "string" ? result.error : "native observation unavailable")}`,
    );
  }
  const parsed = receiptSchema.safeParse(result.data?.selectorCatalog);
  if (!parsed.success)
    throw new Error("iOS selector catalog returned an incomplete native receipt");
  const receipt = parsed.data;
  if (
    receipt.appBundleId !== appBundleId ||
    receipt.systemSurface !== undefined ||
    result.data?.systemSurface !== undefined ||
    result.data?.targetActivation !== undefined ||
    (result.data?.coordinateSpace !== undefined &&
      result.data.coordinateSpace !== "application-logical") ||
    (result.data?.appBundleId !== undefined && result.data.appBundleId !== appBundleId) ||
    receipt.results.length !== queries.length
  ) {
    throw new Error("iOS selector catalog application or query ownership is unavailable");
  }
  for (const [index, row] of receipt.results.entries()) {
    const query = queries[index]!;
    if (
      row.queryIndex !== index ||
      row.selectorKey !== query.selectorKey ||
      row.selectorValue !== query.selectorValue ||
      row.nodes.some(
        (node) =>
          (node.bundleId !== undefined && node.bundleId !== appBundleId) ||
          node.logicalCoordinates === false,
      )
    ) {
      throw new Error("iOS selector catalog returned mismatched selector evidence");
    }
  }
  const homeRows = receipt.results.slice(0, home.length);
  const hamburger = homeRows.some(
    (row) =>
      row.ok &&
      row.nodes.some(
        (node) => (node.identifier?.trim() || row.selectorValue) === "sidebar.open.button",
      ),
  );
  const activeSidebar = hamburger
    ? chromeValuesToQuery(
        [],
        extraIds.filter((value) => sidebarIds.has(value.trim())),
      )
    : sidebar;
  const activeLabels = hamburger
    ? chromeValuesToQuery([], [...IOS_BOUNDED_HOME_CHROME_LABELS, ...(input.includeLabels ?? [])])
    : chromeValuesToQuery(IOS_BOUNDED_CHROME_LABELS, input.includeLabels);
  const catalogIds = new Set<string>([
    ...IOS_BOUNDED_HOME_CHROME_IDENTIFIERS,
    ...(hamburger ? [] : IOS_BOUNDED_SIDEBAR_CHROME_IDENTIFIERS),
  ]);
  const catalogLabels = new Set<string>(
    hamburger ? IOS_BOUNDED_HOME_CHROME_LABELS : IOS_BOUNDED_CHROME_LABELS,
  );
  const orderedQueries: Query[] = [
    ...[...home, ...activeSidebar, ...attach].map((selectorValue): Query => ({
      selectorKey: "id",
      selectorValue,
    })),
    ...activeLabels.map((selectorValue): Query => ({ selectorKey: "label", selectorValue })),
  ];
  const nodes: SnapshotNode[] = [];
  for (const query of orderedQueries) {
    const row = receipt.results.find(
      (candidate) =>
        candidate.selectorKey === query.selectorKey &&
        candidate.selectorValue === query.selectorValue,
    )!;
    if (!row.ok) continue;
    for (const node of row.nodes) {
      const { recordingSelectorSupplemental: _incoming, ...observed } = node;
      nodes.push({
        ...observed,
        bundleId: appBundleId,
        logicalCoordinates: true,
        ...(query.selectorKey === "id"
          ? { identifier: node.identifier?.trim() || query.selectorValue }
          : { label: node.label?.trim() || query.selectorValue }),
        ...(input.separateRequestedSelectorEvidence
          ? {
              recordingSelectorSupplemental: !(
                query.selectorKey === "id" ? catalogIds : catalogLabels
              ).has(query.selectorValue),
            }
          : {}),
      });
    }
  }
  return { nodes, bounds: receipt.bounds };
}
