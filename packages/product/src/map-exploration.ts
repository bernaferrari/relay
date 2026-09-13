import type {
  AppMap,
  AppMapScenarioTestStep,
  Connection,
  ConnectionSourceAnchor,
  OperationInput,
  OperationOutput,
  Proposal,
  Screen,
} from "@relay/protocol";
import { createRelayOperationPort, type RelayInvokeClient } from "@relay/workflows/operation-port";
import { routeUrls } from "./routes.js";

export type ProductMapFailure = {
  readonly id: string;
  readonly outcome: "product-failure" | "harness-failure" | "uncertain";
  readonly screenId?: string;
  readonly runId: string;
  readonly occurredAt?: number;
};

export type ProductMapScreen = {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly position?: { readonly x: number; readonly y: number };
  readonly screenshotUri?: string;
  readonly accessibilityTreeUri?: string;
  readonly variantCount: number;
  /** Retained screenshot choices backed by canonical map evidence. */
  readonly variants: readonly ProductMapScreenVariant[];
  readonly coveringTests: readonly { readonly id: string; readonly name: string }[];
  readonly recentFailures: readonly ProductMapFailure[];
  /** Authored identity-ignore region names. Visual baselines compare chrome only. */
  readonly ignoreRegionNames?: readonly string[];
};

export type ProductMapScreenVariant = {
  readonly id: string;
  readonly screenshotUri: string;
  /** Present only when the retained evidence carries capture-time metadata. */
  readonly capturedAt?: number;
  /** Present only when baseline provenance binds this evidence to a run. */
  readonly sourceRunId?: string;
  /** Present only when canonical evidence explicitly records a locale. */
  readonly locale?: string;
};

export type ProductMapPath = {
  readonly id: string;
  readonly label: string;
  readonly fromScreenId: string;
  readonly toScreenId?: string;
  readonly fromTitle: string;
  readonly toTitle?: string;
  readonly coveringTests: readonly { readonly id: string; readonly name: string }[];
  /** Only projected when the anchor's before frame matches the source screenshot. */
  readonly sourceAnchor?: ConnectionSourceAnchor;
  /** Saved action selector; UI may locate its unique control in the paired tree. */
  readonly sourceTarget?: { label?: string; identifier?: string; text?: string };
};

export type ProductMapProposal = Pick<
  Proposal,
  | "id"
  | "title"
  | "description"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "baseRevision"
  | "sourceRevision"
>;

export type ProductMapOverview = {
  readonly appMapId: string;
  readonly appName: string;
  readonly description?: string;
  readonly revision: number;
  readonly screens: readonly ProductMapScreen[];
  readonly paths: readonly ProductMapPath[];
  readonly coverage: {
    readonly screenCount: number;
    readonly coveredScreenCount: number;
    readonly pathCount: number;
    readonly coveredPathCount: number;
    readonly testCount: number;
  };
  /** Canonical review queue count; details stay behind Developer Mode. */
  readonly pendingProposalCount: number;
  readonly navigation: { readonly route: string; readonly href: string };
};

export type ProductMapService = {
  prepareRefresh?(
    input: OperationInput<"app-map.screen.refresh.prepare">,
  ): Promise<OperationOutput<"app-map.screen.refresh.prepare">>;
  applyRefresh?(input: OperationInput<"app-map.screen.refresh.apply">): Promise<ProductMapOverview>;
  get(appMapId: string): Promise<ProductMapOverview>;
  updateScreen?(input: OperationInput<"app-map.screen.update">): Promise<ProductMapOverview>;
  /** Bounded drilldown over the same canonical App Map snapshot as `get`. */
  getScreen?(appMapId: string, screenId: string): Promise<ProductMapScreen | undefined>;
  getPath?(appMapId: string, pathId: string): Promise<ProductMapPath | undefined>;
  listProposals?(appMapId: string): Promise<readonly ProductMapProposal[]>;
  approveProposal?(input: OperationInput<"app-map.proposal.approve">): Promise<ProductMapOverview>;
  rejectProposal?(input: OperationInput<"app-map.proposal.reject">): Promise<ProductMapOverview>;
};

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 8_192) : fallback;
}

function childSteps(step: AppMapScenarioTestStep): readonly AppMapScenarioTestStep[] {
  if (step.kind === "decision") return [...step.thenSteps, ...(step.elseSteps ?? [])];
  if (step.kind === "loop") return step.steps;
  return [];
}

function connectionIds(steps: readonly AppMapScenarioTestStep[], output = new Set<string>()) {
  for (const step of steps) {
    const binding = step.binding;
    if (binding.status === "resolved" && binding.kind === "connections") {
      for (const id of binding.connectionIds) output.add(id);
    }
    connectionIds(childSteps(step), output);
  }
  return output;
}

function canonicalScreenshotUri(
  variant: AppMap["screenVariants"][string] | undefined,
): string | undefined {
  const uri = variant?.screenshotUri;
  return uri && uri.startsWith("relay-evidence://") && variant.evidenceUris?.includes(uri)
    ? uri
    : undefined;
}

function projectScreenVariants(screen: Screen, map: AppMap): readonly ProductMapScreenVariant[] {
  return screen.variantIds
    .map((id) => map.screenVariants?.[id])
    .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant))
    .map((variant) => {
      const screenshotUri = canonicalScreenshotUri(variant);
      if (!screenshotUri) return undefined;
      const raw = variant.rawAccessibilityTree;
      const provenance = variant.captureProvenance;
      const capturedAt =
        variant.refreshCapture?.capturedAt ??
        provenance?.capturedAt ??
        (raw?.capturedAt !== undefined &&
        raw.uri.startsWith("relay-evidence://") &&
        variant.evidenceUris?.includes(raw.uri)
          ? raw.capturedAt
          : undefined);
      let sourceRunId: string | undefined;
      const source = variant.baseline?.source;
      if (source?.kind === "run" && source.evidenceId) {
        const targetResult = map.targetResults?.[source.targetResultId];
        if (
          targetResult?.runId &&
          variant.evidenceIds.includes(source.evidenceId) &&
          targetResult.evidenceIds.includes(source.evidenceId)
        ) {
          sourceRunId = targetResult.runId;
        }
      }
      if (provenance?.kind === "run") sourceRunId = provenance.runId;
      return {
        id: variant.id,
        screenshotUri,
        ...(capturedAt === undefined ? {} : { capturedAt }),
        ...(sourceRunId === undefined ? {} : { sourceRunId }),
        ...(provenance?.locale ? { locale: provenance.locale } : {}),
      } satisfies ProductMapScreenVariant;
    })
    .filter((variant): variant is ProductMapScreenVariant => Boolean(variant))
    .sort((left, right) => {
      const leftUpdatedAt = map.screenVariants[left.id]?.updatedAt ?? 0;
      const rightUpdatedAt = map.screenVariants[right.id]?.updatedAt ?? 0;
      return rightUpdatedAt - leftUpdatedAt || left.id.localeCompare(right.id);
    });
}

function projectMap(map: AppMap): ProductMapOverview {
  const tests = Object.values(map.tests);
  const testByConnection = new Map<string, { id: string; name: string }[]>();
  for (const test of tests) {
    const summary = { id: test.id, name: text(test.name, "Saved Test") };
    for (const connectionId of connectionIds(test.steps)) {
      const covering = testByConnection.get(connectionId) ?? [];
      covering.push(summary);
      testByConnection.set(connectionId, covering);
    }
  }
  const failuresByScreen = new Map<string, ProductMapFailure[]>();
  for (const result of Object.values(map.targetResults ?? {})) {
    if (
      !result.runId ||
      !["product-failure", "harness-failure", "uncertain"].includes(result.outcome)
    )
      continue;
    const failure: ProductMapFailure = {
      id: result.id,
      outcome: result.outcome as ProductMapFailure["outcome"],
      ...(result.connectionId
        ? { screenId: map.connections[result.connectionId]?.fromScreenId }
        : {}),
      runId: result.runId,
      ...(result.finishedAt === undefined ? {} : { occurredAt: result.finishedAt }),
    };
    if (failure.screenId)
      failuresByScreen.set(failure.screenId, [
        ...(failuresByScreen.get(failure.screenId) ?? []),
        failure,
      ]);
  }
  const screens = Object.values(map.screens).map((screen: Screen) => {
    const variants = projectScreenVariants(screen, map);
    const covering = new Map<string, { id: string; name: string }>();
    for (const connection of Object.values(map.connections)) {
      const reachesScreen =
        connection.fromScreenId === screen.id ||
        (connection.destination.kind === "screen" && connection.destination.screenId === screen.id);
      if (!reachesScreen) continue;
      for (const test of testByConnection.get(connection.id) ?? []) covering.set(test.id, test);
    }
    return {
      id: screen.id,
      title: text(screen.title, "Known screen"),
      ...(screen.description ? { description: text(screen.description, "") } : {}),
      ...(screen.position ? { position: { x: screen.position.x, y: screen.position.y } } : {}),
      screenshotUri: screen.variantIds
        .map((id) => map.screenVariants?.[id])
        .filter((variant) => Boolean(variant?.screenshotUri))
        .sort((a, b) => b!.updatedAt - a!.updatedAt)[0]?.screenshotUri,
      accessibilityTreeUri: screen.variantIds
        .map((id) => map.screenVariants?.[id])
        .filter((variant) => Boolean(variant?.screenshotUri))
        .sort((a, b) => b!.updatedAt - a!.updatedAt)
        .map((variant) => variant?.rawAccessibilityTree?.uri)[0],
      variantCount: screen.variantIds.length,
      variants,
      coveringTests: [...covering.values()],
      recentFailures: (failuresByScreen.get(screen.id) ?? []).slice(0, 8),
      ...(screen.identity?.ignoreRegions?.length
        ? {
            ignoreRegionNames: screen.identity.ignoreRegions.map(
              (region) => region.name?.trim() || "dynamic region",
            ),
          }
        : {}),
    } satisfies ProductMapScreen;
  });
  const paths = Object.values(map.connections).map((connection: Connection) => {
    const destination =
      connection.destination.kind === "screen"
        ? map.screens[connection.destination.screenId]
        : undefined;
    const source = map.screens[connection.fromScreenId];
    const sourceScreenshotUri = screens.find(
      (screen) => screen.id === connection.fromScreenId,
    )?.screenshotUri;
    const capturedSourceUri = connection.recordingSource?.frames?.find(
      (frame) => frame.role === "before",
    )?.uri;
    const sourceAnchor =
      connection.sourceAnchor && sourceScreenshotUri && capturedSourceUri === sourceScreenshotUri
        ? connection.sourceAnchor
        : undefined;
    return {
      id: connection.id,
      label: text(
        connection.label,
        destination ? `Open ${text(destination.title, "screen")}` : "Finish journey",
      ),
      fromScreenId: connection.fromScreenId,
      ...(destination ? { toScreenId: destination.id } : {}),
      fromTitle: text(source?.title, "Known screen"),
      ...(destination ? { toTitle: text(destination.title, "Known screen") } : {}),
      coveringTests: testByConnection.get(connection.id) ?? [],
      ...(sourceAnchor ? { sourceAnchor } : {}),
      sourceTarget: connection.actions?.find((action) => action.kind === "tap")?.target,
    } satisfies ProductMapPath;
  });
  return {
    appMapId: map.id,
    appName: text(map.name, "App"),
    ...(map.description ? { description: text(map.description, "") } : {}),
    revision: map.revision,
    screens,
    paths,
    coverage: {
      screenCount: screens.length,
      coveredScreenCount: screens.filter((screen) => screen.coveringTests.length > 0).length,
      pathCount: paths.length,
      coveredPathCount: paths.filter((path) => path.coveringTests.length > 0).length,
      testCount: tests.length,
    },
    pendingProposalCount: Object.values(map.proposals ?? {}).filter(
      (proposal) => proposal.status === "pending",
    ).length,
    navigation: { route: routeUrls.appMap(map.id), href: routeUrls.appMap(map.id) },
  };
}

function projectProposal(proposal: Proposal): ProductMapProposal {
  return {
    id: proposal.id,
    title: text(proposal.title, "Map proposal"),
    ...(proposal.description ? { description: text(proposal.description, "") } : {}),
    status: proposal.status,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    baseRevision: proposal.baseRevision,
    ...(proposal.sourceRevision === undefined ? {} : { sourceRevision: proposal.sourceRevision }),
  };
}

export function createProductMapService(client: RelayInvokeClient): ProductMapService {
  const operations = createRelayOperationPort(client);
  async function getOverview(appMapId: string): Promise<ProductMapOverview> {
    const { appMap } = await operations.invoke("app-map.get", { appMapId });
    return projectMap(appMap);
  }
  return {
    get: getOverview,
    prepareRefresh(input) {
      return operations.invoke("app-map.screen.refresh.prepare", input);
    },
    async applyRefresh(input) {
      const { appMap } = await operations.invoke("app-map.screen.refresh.apply", input);
      return projectMap(appMap);
    },
    async updateScreen(input) {
      const { appMap } = await operations.invoke("app-map.screen.update", input);
      return projectMap(appMap);
    },
    async getScreen(appMapId, screenId) {
      return (await getOverview(appMapId)).screens.find((screen) => screen.id === screenId);
    },
    async getPath(appMapId, pathId) {
      return (await getOverview(appMapId)).paths.find((path) => path.id === pathId);
    },
    async listProposals(appMapId) {
      const { appMap } = await operations.invoke("app-map.get", { appMapId });
      return Object.values(appMap.proposals ?? {})
        .map(projectProposal)
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
        );
    },
    async approveProposal(input) {
      const { appMap } = await operations.invoke("app-map.proposal.approve", input);
      return projectMap(appMap);
    },
    async rejectProposal(input) {
      const { appMap } = await operations.invoke("app-map.proposal.reject", input);
      return projectMap(appMap);
    },
  };
}

export function projectProductMap(map: AppMap): ProductMapOverview {
  return projectMap(map);
}
