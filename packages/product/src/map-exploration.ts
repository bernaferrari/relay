import type { AppMap, AppMapScenarioTestStep, Connection, Screen } from "@relay/protocol";
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
  readonly variantCount: number;
  readonly coveringTests: readonly { readonly id: string; readonly name: string }[];
  readonly recentFailures: readonly ProductMapFailure[];
};

export type ProductMapPath = {
  readonly id: string;
  readonly label: string;
  readonly fromScreenId: string;
  readonly toScreenId?: string;
  readonly fromTitle: string;
  readonly toTitle?: string;
  readonly coveringTests: readonly { readonly id: string; readonly name: string }[];
};

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
  get(appMapId: string): Promise<ProductMapOverview>;
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
      variantCount: screen.variantIds.length,
      coveringTests: [...covering.values()],
      recentFailures: (failuresByScreen.get(screen.id) ?? []).slice(0, 8),
    } satisfies ProductMapScreen;
  });
  const paths = Object.values(map.connections).map((connection: Connection) => {
    const destination =
      connection.destination.kind === "screen"
        ? map.screens[connection.destination.screenId]
        : undefined;
    const source = map.screens[connection.fromScreenId];
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

export function createProductMapService(client: RelayInvokeClient): ProductMapService {
  const operations = createRelayOperationPort(client);
  return {
    async get(appMapId) {
      const { appMap } = await operations.invoke("app-map.get", { appMapId });
      return projectMap(appMap);
    },
  };
}

export function projectProductMap(map: AppMap): ProductMapOverview {
  return projectMap(map);
}
