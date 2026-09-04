import type {
  AppMap,
  AppMapCombine,
  AppMapCombinePreflight,
  BrowserAuthenticationFixture,
  BrowserEnvironmentInput,
  OperationOutput,
  TargetDefinition,
  TargetPreflight,
} from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

type BuildDto = OperationOutput<"build.list">["builds"][number];

/** Product-facing view of one existing App Map Combine.
 *
 * A Suite is a projection, not a second persisted matrix. The Combine remains
 * the source of truth for tests, variables, selection, and expansion strategy.
 */
export type ProductSuiteTest = {
  readonly id: string;
  readonly name: string;
  readonly status: "ready" | "needs-review";
};

export type ProductSuite = {
  readonly id: string;
  readonly appMapId: string;
  readonly appMapRevision: number;
  readonly appName: string;
  readonly name: string;
  readonly testIds: readonly string[];
  readonly tests: readonly ProductSuiteTest[];
  readonly variableIds: readonly string[];
  readonly strategy: AppMapCombine["strategy"];
  readonly selected?: Readonly<Record<string, readonly string[]>>;
  /** The canonical Combine is still the durable object behind this view. */
  readonly source: { readonly kind: "app-map-combine"; readonly id: string };
};

export type ProductSuiteInput = {
  readonly appMapId: string;
  readonly suiteId: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly testIds: readonly string[];
  readonly variableIds: readonly string[];
  readonly strategy: NonNullable<AppMapCombine["strategy"]>;
  readonly selected?: Readonly<Record<string, readonly string[]>>;
};

export type ProductSuiteEditor = {
  readonly appMapId: string;
  readonly appName: string;
  readonly revision: number;
  readonly tests: readonly ProductSuiteTest[];
  readonly dataSets: readonly {
    id: string;
    name: string;
    kind: AppMap["variables"][string]["kind"];
    optionCount: number;
  }[];
};

export type ProductBuildOption = Pick<
  BuildDto,
  "id" | "name" | "platform" | "status" | "applicationId" | "sourceSha" | "updatedAt"
>;

/** A browser fixture's metadata is safe to expose; credentials never cross
 * this seam. */
export type ProductAuthenticationFixture = Pick<
  BrowserAuthenticationFixture,
  | "id"
  | "reference"
  | "revision"
  | "targetId"
  | "name"
  | "origins"
  | "cookieCount"
  | "createdAt"
  | "expiresAt"
  | "revokedAt"
>;

/**
 * A reusable environment candidate assembled from canonical target/build/auth
 * catalogs. It deliberately does not pretend to be a frozen TargetProfile:
 * that evidence object is only created when a Test actually compiles/runs.
 * `builds` and `authenticationFixtures` are available project resources, not
 * an invented persisted association with this target.
 */
export type ProductEnvironmentProfile = {
  readonly id: string;
  readonly name: string;
  readonly targetId: string;
  /** Environment Profiles are backed by durable managed targets. The frozen
   * execution profile is still created and checked when a Suite runs. */
  readonly source: { readonly kind: "managed-target"; readonly id: string };
  readonly target: Pick<TargetDefinition, "id" | "name" | "kind" | "browser">;
  readonly platform: TargetDefinition["kind"];
  readonly browserEnvironment?: BrowserEnvironmentInput;
  /** Available resources, not silently persisted bindings on the profile. */
  readonly authenticationOptions: readonly ProductAuthenticationFixture[];
  readonly buildOptions: readonly ProductBuildOption[];
};

export type ProductEnvironmentPreflight = {
  readonly profile: ProductEnvironmentProfile;
  readonly target: TargetPreflight;
  readonly build?: OperationOutput<"build.preflight">["preflight"];
  readonly authentication?: ProductAuthenticationPreflight;
};

export type ProductAuthenticationPreflight = {
  readonly ok: boolean;
  readonly fixture?: ProductAuthenticationFixture;
  readonly message?: string;
};

export type ProductSuiteIssue = {
  readonly code: string;
  readonly message: string;
  readonly suiteCellId?: string;
};

export type ProductSuitePreview = {
  readonly suite: ProductSuite;
  readonly environment?: ProductEnvironmentProfile;
  readonly caseCount: number;
  readonly checkCount: number;
  readonly expectedScreenshots?: number;
  readonly blockers: readonly ProductSuiteIssue[];
  readonly warnings: readonly ProductSuiteIssue[];
};

export type SuiteProfileProductService = {
  listSuites(appMapId?: string): Promise<readonly ProductSuite[]>;
  getSuite(appMapId: string, suiteId: string): Promise<ProductSuite | undefined>;
  getSuiteEditor(appMapId: string): Promise<ProductSuiteEditor>;
  saveSuite(input: ProductSuiteInput): Promise<ProductSuite>;
  removeSuite(input: {
    appMapId: string;
    suiteId: string;
    expectedRevision: number;
  }): Promise<void>;
  listEnvironmentProfiles(): Promise<readonly ProductEnvironmentProfile[]>;
  getEnvironmentProfile(profileId: string): Promise<ProductEnvironmentProfile | undefined>;
  previewSuite(input: {
    appMapId: string;
    suiteId: string;
    profileId?: string;
  }): Promise<ProductSuitePreview>;
  preflightEnvironment(input: {
    profileId: string;
    buildId?: string;
    authenticationFixtureReference?: string;
  }): Promise<ProductEnvironmentPreflight>;
  startSuite(input: {
    appMapId: string;
    suiteId: string;
    profileId: string;
    executionMode?: "pilot" | "all";
  }): Promise<{ batchId: string }>;
};

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 8_192) : fallback;
}

function testStatus(test: AppMap["tests"][string]): ProductSuiteTest["status"] {
  const unresolved = (step: AppMap["tests"][string]["steps"][number]): boolean => {
    if (step.binding.status === "unresolved" || step.execution?.status === "disabled") return true;
    if (step.kind === "decision") {
      return step.thenSteps.some(unresolved) || (step.elseSteps?.some(unresolved) ?? false);
    }
    if (step.kind === "loop") return step.steps.some(unresolved);
    return false;
  };
  return test.steps.length === 0 || test.steps.some(unresolved) ? "needs-review" : "ready";
}

/** Pure projection used by the service and fixture tests. */
export function projectProductSuite(map: AppMap, combine: AppMapCombine): ProductSuite {
  const tests = combine.testIds.map((id) => {
    const test = map.tests[id];
    return {
      id,
      name: text(test?.name, id),
      status: test ? testStatus(test) : "needs-review",
    } satisfies ProductSuiteTest;
  });
  return {
    id: combine.id,
    appMapId: map.id,
    appMapRevision: map.revision,
    appName: text(map.name, "App"),
    name: text(combine.name, "Suite"),
    testIds: [...combine.testIds],
    tests,
    variableIds: [...combine.variableIds],
    strategy: combine.strategy,
    ...(combine.selected ? { selected: structuredClone(combine.selected) } : {}),
    source: { kind: "app-map-combine", id: combine.id },
  };
}

function projectBuild(build: BuildDto): ProductBuildOption {
  return {
    id: build.id,
    name: build.name,
    platform: build.platform,
    status: build.status,
    ...(build.applicationId ? { applicationId: build.applicationId } : {}),
    ...(build.sourceSha ? { sourceSha: build.sourceSha } : {}),
    updatedAt: build.updatedAt,
  };
}

function projectFixture(fixture: BrowserAuthenticationFixture): ProductAuthenticationFixture {
  return {
    id: fixture.id,
    reference: fixture.reference,
    revision: fixture.revision,
    targetId: fixture.targetId,
    name: fixture.name,
    origins: [...fixture.origins],
    cookieCount: fixture.cookieCount,
    createdAt: fixture.createdAt,
    ...(fixture.expiresAt === undefined ? {} : { expiresAt: fixture.expiresAt }),
    ...(fixture.revokedAt === undefined ? {} : { revokedAt: fixture.revokedAt }),
  };
}

/** Pure target/resource projection. No TargetProfile or browser engine model is copied here. */
export function projectProductEnvironmentProfiles(input: {
  targets: readonly TargetDefinition[];
  builds?: readonly BuildDto[];
  fixtures?: readonly BrowserAuthenticationFixture[];
}): readonly ProductEnvironmentProfile[] {
  const builds = (input.builds ?? []).map(projectBuild);
  return input.targets
    .map((target) => ({
      id: target.id,
      name: text(target.name, target.id),
      targetId: target.id,
      source: { kind: "managed-target" as const, id: target.id },
      target: {
        id: target.id,
        name: text(target.name, target.id),
        kind: target.kind,
        ...(target.browser ? { browser: structuredClone(target.browser) } : {}),
      },
      platform: target.kind,
      ...(target.browser?.environment
        ? { browserEnvironment: structuredClone(target.browser.environment) }
        : {}),
      authenticationOptions: (input.fixtures ?? [])
        .filter((fixture) => fixture.targetId === target.id)
        .map(projectFixture),
      buildOptions: builds.filter((build) =>
        target.kind === "browser" ? build.platform === "web" : build.platform === target.kind,
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

/**
 * Account preflight is intentionally metadata-only. Relay has no operation
 * that proves a live account session without launching a browser, so this
 * checks exact fixture identity and lifecycle state but never claims login
 * validity.
 */
export function assessProductAuthenticationFixture(
  profile: ProductEnvironmentProfile,
  reference: string,
  now = Date.now(),
): ProductAuthenticationPreflight {
  const fixture = profile.authenticationOptions.find(
    (candidate) => candidate.reference === reference,
  );
  if (!fixture) {
    return {
      ok: false,
      message: "The selected account fixture is not available for this environment.",
    };
  }
  if (fixture.revokedAt !== undefined) {
    return { ok: false, fixture, message: "The selected account fixture has been revoked." };
  }
  if (fixture.expiresAt !== undefined && fixture.expiresAt <= now) {
    return { ok: false, fixture, message: "The selected account fixture has expired." };
  }
  return { ok: true, fixture };
}

function issue(value: { code?: unknown; message?: unknown; cellId?: unknown }): ProductSuiteIssue {
  return {
    code: text(value.code, "preflight-blocked"),
    message: text(value.message, "Relay could not prove this Suite is ready."),
    ...(typeof value.cellId === "string" ? { suiteCellId: value.cellId } : {}),
  };
}

function previewFromPreflight(
  suite: ProductSuite,
  preflight: AppMapCombinePreflight,
  environment?: ProductEnvironmentProfile,
  targetPreflight?: TargetPreflight,
): ProductSuitePreview {
  const targetProblems = targetPreflight?.checks.filter((check) => check.status !== "pass") ?? [];
  return {
    suite,
    ...(environment ? { environment } : {}),
    caseCount: preflight.deviceRuns,
    checkCount: preflight.checks,
    ...(preflight.expectedScreenshots === undefined
      ? {}
      : { expectedScreenshots: preflight.expectedScreenshots }),
    blockers: [
      ...preflight.blockers.map(issue),
      ...targetProblems
        .filter((check) => check.status === "fail")
        .map((check) => ({ code: `target-${check.id}`, message: check.message })),
    ],
    warnings: [
      ...preflight.warnings.map(issue),
      ...targetProblems
        .filter((check) => check.status === "warning")
        .map((check) => ({ code: `target-${check.id}`, message: check.message })),
    ],
  };
}

function projectSuiteEditor(appMap: AppMap): ProductSuiteEditor {
  return {
    appMapId: appMap.id,
    appName: text(appMap.name, "App"),
    revision: appMap.revision,
    tests: Object.values(appMap.tests)
      .map((test) => ({ id: test.id, name: text(test.name, test.id), status: testStatus(test) }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    dataSets: Object.values(appMap.variables)
      .map((variable) => ({
        id: variable.id,
        name: text(variable.name, variable.id),
        kind: variable.kind,
        optionCount: variable.options.length,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function createSuiteProfileProductService(platform: Platform): SuiteProfileProductService {
  let clientPromise: ReturnType<typeof productClientForPlatform> | undefined;
  const client = () =>
    (clientPromise ??= productClientForPlatform(platform)).then(({ client: relay }) => relay);

  async function map(appMapId: string): Promise<AppMap> {
    return (await (await client()).invoke("app-map.get", { appMapId })).appMap;
  }

  async function environments(): Promise<readonly ProductEnvironmentProfile[]> {
    const relay = await client();
    const [{ targets }, { builds }] = await Promise.all([
      relay.invoke("target.list", {}),
      relay.invoke("build.list", {}),
    ]);
    const fixtures = (
      await Promise.all(
        targets
          .filter((target) => target.kind === "browser")
          .map((target) => relay.invoke("target.browser-auth.list", { targetId: target.id })),
      )
    ).flatMap(({ fixtures: values }) => values);
    return projectProductEnvironmentProfiles({ targets, builds, fixtures });
  }

  return {
    async listSuites(appMapId) {
      const maps = appMapId
        ? [await map(appMapId)]
        : (await (await client()).invoke("app-map.list", {})).appMaps;
      return maps
        .flatMap((item) =>
          Object.values(item.combines).map((combine) => projectProductSuite(item, combine)),
        )
        .sort(
          (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
        );
    },
    async getSuite(appMapId, suiteId) {
      const appMap = await map(appMapId);
      const item = appMap.combines[suiteId];
      return item ? projectProductSuite(appMap, item) : undefined;
    },
    async getSuiteEditor(appMapId) {
      return projectSuiteEditor(await map(appMapId));
    },
    async saveSuite(input) {
      const appMap = await map(input.appMapId);
      if (appMap.revision !== input.expectedRevision) {
        throw new TypeError(
          "This App changed while you were editing. Reload the Suite and try again.",
        );
      }
      const name = input.name.trim();
      if (!input.suiteId.trim()) throw new TypeError("Suite identity is required.");
      if (!name) throw new TypeError("Give this Suite a name.");
      const testIds = [...new Set(input.testIds.map((id) => id.trim()).filter(Boolean))];
      if (!testIds.length) throw new TypeError("Select at least one Test for this Suite.");
      const missingTest = testIds.find((id) => !appMap.tests[id]);
      if (missingTest)
        throw new TypeError(`Test ${missingTest} is no longer available in this App.`);
      const variableIds = [...new Set(input.variableIds.map((id) => id.trim()).filter(Boolean))];
      const missingVariable = variableIds.find((id) => !appMap.variables[id]);
      if (missingVariable) {
        throw new TypeError(`Data set ${missingVariable} is no longer available in this App.`);
      }
      const selected = input.selected
        ? Object.fromEntries(
            Object.entries(input.selected)
              .filter(([id]) => variableIds.includes(id))
              .map(([id, values]) => [id, [...new Set(values)]] as const)
              .filter((entry) => entry[1].length > 0),
          )
        : undefined;
      const existing = appMap.combines[input.suiteId];
      const result = await (
        await client()
      ).invoke("app-map.combine.save", {
        appMapId: input.appMapId,
        combineId: input.suiteId,
        expectedRevision: input.expectedRevision,
        combine: {
          ...existing,
          id: input.suiteId,
          name,
          testIds,
          variableIds,
          strategy: input.strategy,
          selected: selected && Object.keys(selected).length ? selected : undefined,
        } as AppMapCombine,
      });
      const saved = result.appMap.combines[input.suiteId];
      if (!saved) throw new TypeError("Relay saved the App, but the Suite is unavailable.");
      return projectProductSuite(result.appMap, saved);
    },
    async removeSuite(input) {
      const appMap = await map(input.appMapId);
      if (!appMap.combines[input.suiteId]) return;
      if (appMap.revision !== input.expectedRevision) {
        throw new TypeError(
          "This App changed while you were editing. Reload the Suite and try again.",
        );
      }
      await (
        await client()
      ).invoke("app-map.combine.remove", {
        appMapId: input.appMapId,
        combineId: input.suiteId,
        expectedRevision: input.expectedRevision,
      });
    },
    listEnvironmentProfiles: environments,
    async getEnvironmentProfile(profileId) {
      return (await environments()).find((profile) => profile.id === profileId);
    },
    async previewSuite(input) {
      const appMap = await map(input.appMapId);
      const combine = appMap.combines[input.suiteId];
      if (!combine) throw new TypeError(`Suite ${input.suiteId} is not available in this App.`);
      const suite = projectProductSuite(appMap, combine);
      const environment = input.profileId
        ? (await environments()).find((profile) => profile.id === input.profileId)
        : undefined;
      if (input.profileId && !environment) {
        throw new TypeError(`Environment profile ${input.profileId} is not available.`);
      }
      const relay = await client();
      const [preflight, targetPreflight] = await Promise.all([
        relay.invoke("app-map.combine.preflight", {
          appMapId: input.appMapId,
          combineId: input.suiteId,
          ...(environment && environment.platform !== "browser"
            ? { serial: environment.target.id }
            : {}),
        }),
        environment
          ? relay.invoke("target.preflight", { targetId: environment.target.id })
          : Promise.resolve(undefined),
      ]);
      return previewFromPreflight(
        suite,
        preflight.preflight,
        environment,
        targetPreflight?.preflight,
      );
    },
    async preflightEnvironment(input) {
      const relay = await client();
      const profile = (await environments()).find((candidate) => candidate.id === input.profileId);
      if (!profile) throw new TypeError(`Environment profile ${input.profileId} is not available.`);
      const target = await relay.invoke("target.preflight", { targetId: profile.target.id });
      const authentication = input.authenticationFixtureReference
        ? assessProductAuthenticationFixture(profile, input.authenticationFixtureReference)
        : undefined;
      if (!input.buildId) {
        return { profile, target: target.preflight, ...(authentication ? { authentication } : {}) };
      }
      const build = profile.buildOptions.find((candidate) => candidate.id === input.buildId);
      if (!build) throw new TypeError(`Build ${input.buildId} is not available in this project.`);
      const result = await relay.invoke("build.preflight", {
        buildId: build.id,
        ...(profile.platform === "browser" ? {} : { serial: profile.target.id }),
      });
      return {
        profile,
        target: target.preflight,
        build: result.preflight,
        ...(authentication ? { authentication } : {}),
      };
    },
    async startSuite(input) {
      const profile = (await environments()).find((candidate) => candidate.id === input.profileId);
      if (!profile) throw new TypeError(`Environment ${input.profileId} is not available.`);
      const result = await (
        await client()
      ).invoke("job.combine.start", {
        appMapId: input.appMapId,
        combineId: input.suiteId,
        executionMode: input.executionMode ?? "pilot",
        ...(profile.platform === "browser"
          ? { targetKind: "browser" as const, browserTargetId: profile.targetId }
          : {
              targetKind: "device" as const,
              serial: profile.targetId,
              platform: profile.platform,
            }),
      });
      const batchId = result.campaign?.id ?? result.batch.id;
      if (!batchId) throw new TypeError("Relay started this Suite without a Batch identity.");
      return { batchId };
    },
  };
}
