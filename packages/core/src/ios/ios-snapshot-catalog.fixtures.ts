import type {
  LiveIosRunnerCommand,
  LiveIosRunnerCommandPost,
  LiveIosRunnerCommandResult,
} from "./ios-runner-listener-command.js";

/** Adapt older fixture answers to the native read classifier; production performs one OR query. */
export function catalogAwarePost(
  post: LiveIosRunnerCommandPost,
  bounds = { x: 0, y: 0, width: 1112, height: 834 },
): LiveIosRunnerCommandPost {
  return async (listener, command, timeoutMs) => {
    if (command.command !== "querySelectorCatalog") return post(listener, command, timeoutMs);
    const queries = command.selectorQueries as Array<{
      selectorKey: string;
      selectorValue: string;
    }>;
    const results = [];
    for (const [queryIndex, query] of queries.entries()) {
      const response = await post(
        listener,
        { ...command, command: "querySelector", ...query },
        timeoutMs,
      );
      if (response.data?.systemSurface)
        return {
          ok: false,
          error: {
            code: "SELECTOR_CATALOG_UNAVAILABLE",
            message: "Catalog observation returned a system surface",
          },
        };
      if (
        response.ok === false &&
        (typeof response.error !== "object" || response.error?.code !== "AMBIGUOUS_MATCH")
      )
        return response;
      const nodes = (response.data?.nodes ?? response.nodes ?? []).map((node) => ({
        ...node,
        hittable: node.hittable ?? true,
        rect: node.rect ?? { x: 10, y: 10, width: 44, height: 44 },
      }));
      const ambiguous = response.ok === false || nodes.filter((node) => node.hittable).length > 1;
      const selected = nodes.filter((node) => node.hittable);
      results.push({
        queryIndex,
        ...query,
        ok: !ambiguous,
        ...(ambiguous ? { error: { code: "AMBIGUOUS_MATCH" } } : { found: selected.length === 1 }),
        rawMatchCount: Math.max(nodes.length, ambiguous ? 2 : 0),
        hittableMatchCount: Math.max(selected.length, ambiguous ? 2 : 0),
        nodes: ambiguous ? [] : selected,
      });
    }
    return {
      ok: true,
      data: {
        selectorCatalog: {
          version: 1,
          source: "xcui-selector-catalog",
          coverage: "requested-selectors",
          appBundleId: command.appBundleId,
          appStateBefore: "runningForeground",
          appStateAfter: "runningForeground",
          coordinateSpace: "application-logical",
          geometrySource: "xcui-window-frame",
          bounds,
          results,
        },
      },
    };
  };
}

export function emptyCatalogResult(command: LiveIosRunnerCommand): LiveIosRunnerCommandResult {
  const queries = command.selectorQueries as Array<{ selectorKey: string; selectorValue: string }>;
  return {
    ok: true,
    data: {
      selectorCatalog: {
        version: 1,
        source: "xcui-selector-catalog",
        coverage: "requested-selectors",
        appBundleId: command.appBundleId,
        appStateBefore: "runningForeground",
        appStateAfter: "runningForeground",
        coordinateSpace: "application-logical",
        geometrySource: "xcui-window-frame",
        bounds: { x: 0, y: 0, width: 1112, height: 834 },
        results: queries.map((query, queryIndex) => ({
          queryIndex,
          ...query,
          ok: true,
          found: false,
          rawMatchCount: 0,
          hittableMatchCount: 0,
          nodes: [],
        })),
      },
    },
  };
}
