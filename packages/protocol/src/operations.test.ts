import assert from "node:assert/strict";
import test from "node:test";
import {
  operationDefinition,
  operationDefinitions,
  operationManifest,
  projectRoleAllows,
  validateOperationDefinitions,
  type OperationDefinition,
  type OperationInput,
} from "./operations.js";
import {
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
} from "./reviewed-document-origin.js";
import { operationInputSchemas } from "./operation-input-schemas.js";
import { operationOutputSchemas } from "./operation-output-schemas.js";
import { graphTest } from "./app-map-test-operation-schemas.js";

test("graph Test schema accepts wait-response and rejects unsafe timing bounds", () => {
  const step = {
    id: "wait-answer",
    intent: "Wait for generated answer",
    kind: "validation" as const,
    binding: {
      status: "resolved" as const,
      kind: "recipe-step" as const,
      step: {
        kind: "wait-response" as const,
        target: { role: "article", text: "ChatGPT said" },
        busyTarget: { label: "Stop generating" },
        idleTarget: { label: "Send message" },
        timeoutMs: 5_000,
        stableForMs: 500,
      },
    },
  };
  assert.doesNotThrow(() =>
    graphTest.parse({
      name: "ChatGPT response",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [step],
    }),
  );
  assert.throws(
    () =>
      graphTest.parse({
        name: "ChatGPT response",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            ...step,
            binding: { ...step.binding, step: { ...step.binding.step, stableForMs: 499 } },
          },
        ],
      }),
    /stableForMs/u,
  );
});

test("operation descriptors have unique IDs, transports, and complete safety metadata", () => {
  assert.doesNotThrow(() => validateOperationDefinitions());
  assert.equal(
    new Set(operationDefinitions.map((item) => item.id)).size,
    operationDefinitions.length,
  );
});

test("registered descriptors and schema-first registries stay in exact parity", () => {
  const registeredIds = operationDefinitions.map(({ id }) => id).sort();
  assert.deepEqual(Object.keys(operationInputSchemas).sort(), registeredIds);

  const schemaBackedOutputIds = operationDefinitions
    .filter(({ id, output }) => output.description === `${id} output`)
    .map(({ id }) => id)
    .sort();
  assert.deepEqual(Object.keys(operationOutputSchemas).sort(), schemaBackedOutputIds);
  assert.throws(
    () => operationDefinition("target.create").output.parse({ target: { id: "target-1" } }),
    /invalid_type|expected/u,
  );
});

test("GET Run inputs normalize their HTTP query representations", () => {
  assert.deepEqual(
    operationDefinition("run.evidence.get").input.parse({
      runId: "run-1",
      limit: "250",
      includeBodies: "false",
    }),
    { runId: "run-1", limit: 250, includeBodies: false },
  );
  assert.deepEqual(operationDefinition("run.list").input.parse({ limit: "40" }), { limit: 40 });
});

test("browser target operations round-trip the frozen environment contract", () => {
  const environment = {
    engine: "webkit" as const,
    viewport: { width: 1024, height: 768 },
    locale: "pt-BR",
    timezoneId: "UTC",
    environmentRevision: "relay.browser-environment.v1",
  };
  const input = {
    id: "browser-staging",
    name: "Browser staging",
    startUrl: "https://example.test/",
    headless: true,
    viewport: { width: 1280, height: 800 },
    environment,
  };
  assert.deepEqual(operationDefinition("target.create").input.parse(input), input);

  const target = {
    id: "browser-staging",
    name: "Browser staging",
    kind: "browser" as const,
    createdAt: 1,
    updatedAt: 2,
    browser: {
      startUrl: input.startUrl,
      headless: true,
      viewport: input.viewport,
      environment,
    },
  };
  assert.deepEqual(operationDefinition("target.create").output.parse({ target }).target, target);
  assert.deepEqual(operationDefinition("target.list").output.parse({ targets: [target] }).targets, [
    target,
  ]);
});

test("build registration accepts a verified web deployment identity", () => {
  const build = {
    id: "web-preview",
    name: "Web preview",
    platform: "web" as const,
    sourceUrl: "https://preview.example.com/pr-184",
    sourceSha: "a".repeat(40),
    deploymentDigest: `sha256:${"b".repeat(64)}`,
    configuration: "web.production",
    environmentRevision: "preview-v12",
    webDeploymentMode: "provider-verified",
    webProviderReceipt: {
      schemaVersion: 1,
      issuer: "relay-web-deployment-provider",
      provider: "vercel",
      deploymentId: "web-preview",
      sourceUrl: "https://preview.example.com/pr-184",
      sourceSha: "a".repeat(40),
      deploymentDigest: `sha256:${"b".repeat(64)}`,
      configuration: "web.production",
      environmentRevision: "preview-v12",
      issuedAt: 1,
      signature: "s".repeat(43),
    },
    status: "ready",
  };
  assert.deepEqual(operationDefinition("build.save").input.parse(build), build);
  assert.throws(
    () =>
      operationDefinition("build.save").input.parse({
        ...build,
        deploymentDigest: "not-a-digest",
      }),
    /deploymentDigest/u,
  );
  const receiptOnly = {
    id: build.id,
    name: build.name,
    platform: build.platform,
    webDeploymentMode: build.webDeploymentMode,
    webProviderReceipt: build.webProviderReceipt,
    status: build.status,
  };
  assert.deepEqual(operationDefinition("build.save").input.parse(receiptOnly), receiptOnly);
  const localDevelopment = {
    id: "web-local",
    name: "Local web development",
    platform: "web" as const,
    webDeploymentMode: "self-managed" as const,
    sourceUrl: "http://localhost:4173",
    status: "ready" as const,
  };
  assert.deepEqual(
    operationDefinition("build.save").input.parse(localDevelopment),
    localDevelopment,
  );
});

test("compiled Recipe storage is absent from the public operation registry", () => {
  assert.deepEqual(
    operationDefinitions.filter(({ id }) => id.startsWith("recipe.")),
    [],
  );
  assert.deepEqual(
    operationDefinitions.filter(({ transport }) => transport.path.startsWith("/recipes")),
    [],
  );
});

test("graph Test transport accepts reviewed layout assertions for route variants", () => {
  const layout = {
    status: "resolved" as const,
    kind: "assertion" as const,
    assertion: {
      kind: "layout" as const,
      relation: "non-overlap" as const,
      first: { identifier: "description" },
      second: { identifier: "primary-action" },
    },
  };
  const input = {
    appMapId: "settings",
    testId: "arabic-layout",
    expectedRevision: 4,
    test: {
      name: "Arabic layout",
      kind: "scenario" as const,
      intentSchemaVersion: 1 as const,
      originApplication: "com.example.settings",
      steps: [
        {
          id: "verify-layout",
          kind: "validation" as const,
          intent: "Translated content does not overlap",
          binding: layout,
        },
      ],
      family: {
        logicalIntentRevision: 1,
        bindingRevision: 1,
        routeVariants: [
          {
            id: "compact-browser",
            revision: 1,
            predicate: { platforms: ["browser" as const] },
            bindings: { "verify-layout": layout },
            reviewedAt: 1,
            reviewedBy: "human:reviewer",
          },
        ],
      },
    },
  };
  assert.deepEqual(operationDefinition("app-map.test.save").input.parse(input), input);
  assert.throws(
    () =>
      operationInputSchemas["app-map.test.save"].parse({
        ...input,
        test: { ...input.test, id: "server-owned" },
      }),
    /unrecognized key|id/u,
  );
});

test("campaign capacity preflight remains composed into the central operation registry", () => {
  const definition = operationDefinition("campaign.capacity.preflight");
  assert.equal(definition.transport.method, "POST");
  assert.equal(definition.transport.path, "/campaign-capacity/preflight");
  assert.equal(definition.input.description, "campaign capacity preflight input");
  assert.equal(definition.output.description, "campaign capacity preflight response");
});

test("Proof exposes its canonical lifecycle operations plus execution and list queries", () => {
  const proofIds = operationDefinitions
    .filter(({ id }) => id.startsWith("proof."))
    .map(({ id }) => id);
  assert.deepEqual(proofIds, [
    "proof.setup.inspect",
    "proof.setup.preview",
    "proof.setup.apply",
    "proof.prepare",
    "proof.start",
    "proof.list",
    "proof.inspect",
    "proof.plan.approve",
    "proof.continue",
    "proof.run",
    "proof.run.confirm",
    "proof.run.human-evidence",
    "proof.cancel",
    "proof.publication.retry",
    "proof.rerun-affected",
  ]);
  assert.deepEqual(
    proofIds.filter((id) => id !== "proof.list" && id !== "proof.setup.inspect"),
    [
      "proof.setup.preview",
      "proof.setup.apply",
      "proof.prepare",
      "proof.start",
      "proof.inspect",
      "proof.plan.approve",
      "proof.continue",
      "proof.run",
      "proof.run.confirm",
      "proof.run.human-evidence",
      "proof.cancel",
      "proof.publication.retry",
      "proof.rerun-affected",
    ],
  );

  const metadata = Object.fromEntries(
    proofIds.map((id) => {
      const definition = operationDefinition(id);
      return [
        id,
        {
          role: definition.minimumRole,
          confirmation: definition.confirmation,
          lease: definition.lease,
          progress: definition.progress,
          cancellable: definition.cancellable,
          transport: definition.transport,
        },
      ];
    }),
  );
  assert.deepEqual(metadata, {
    "proof.setup.inspect": {
      role: "viewer",
      confirmation: "none",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "GET", path: "/proofs/setup" },
    },
    "proof.setup.preview": {
      role: "author",
      confirmation: "none",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/setup/preview" },
    },
    "proof.setup.apply": {
      role: "author",
      confirmation: "confirm",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/setup/apply" },
    },
    "proof.prepare": {
      role: "author",
      confirmation: "none",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/prepare" },
    },
    "proof.start": {
      role: "author",
      confirmation: "none",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs" },
    },
    "proof.list": {
      role: "viewer",
      confirmation: "none",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "GET", path: "/proofs" },
    },
    "proof.inspect": {
      role: "viewer",
      confirmation: "none",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "GET", path: "/proofs/:proofId" },
    },
    "proof.plan.approve": {
      role: "author",
      confirmation: "confirm",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/:proofId/plan/approve" },
    },
    "proof.continue": {
      role: "author",
      confirmation: "none",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/:proofId/continue" },
    },
    "proof.run": {
      role: "runner",
      confirmation: "none",
      lease: "none",
      progress: true,
      cancellable: true,
      transport: { method: "POST", path: "/proofs/:proofId/run" },
    },
    "proof.run.confirm": {
      role: "author",
      confirmation: "confirm",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/:proofId/run/confirm" },
    },
    "proof.run.human-evidence": {
      role: "author",
      confirmation: "confirm",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/:proofId/run/human-evidence" },
    },
    "proof.cancel": {
      role: "author",
      confirmation: "confirm",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/:proofId/cancel" },
    },
    "proof.publication.retry": {
      role: "author",
      confirmation: "confirm",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: {
        method: "POST",
        path: "/proofs/:proofId/publications/:publicationId/retry",
      },
    },
    "proof.rerun-affected": {
      role: "author",
      confirmation: "none",
      lease: "none",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/proofs/:proofId/rerun-affected" },
    },
  });

  assert.throws(() =>
    operationDefinition("proof.prepare").input.parse({
      baseRef: "main",
      headSha: "2".repeat(40),
    }),
  );
  assert.deepEqual(
    operationDefinition("proof.publication.retry").input.parse({
      proofId: "proof-1",
      publicationId: "publication-1",
      expectedProofVersion: 4,
      reason: "GitHub is reachable again.",
      confirm: true,
    }),
    {
      proofId: "proof-1",
      publicationId: "publication-1",
      expectedProofVersion: 4,
      reason: "GitHub is reachable again.",
      confirm: true,
    },
  );
  assert.throws(() =>
    operationDefinition("proof.start").input.parse({
      change: { repository: "acme/relay", baseSha: "1".repeat(40), headSha: "2".repeat(40) },
      policy: { id: "relay.default", version: 1 },
      organizationId: "forged",
    }),
  );
  assert.throws(() =>
    operationDefinition("proof.cancel").input.parse({
      proofId: "proof-1",
      expectedVersion: 0,
      reason: "stop",
      confirm: true,
    }),
  );
  const proofContinue = operationDefinition("proof.continue").input;
  assert.doesNotThrow(() =>
    proofContinue.parse({
      proofId: "proof-1",
      expectedVersion: 1,
      action: "start-pilot",
      reason: "Run the representative Proof case.",
    }),
  );
  assert.doesNotThrow(() =>
    proofContinue.parse({
      proofId: "proof-1",
      expectedVersion: 1,
      action: "start-required-coverage",
      reason: "Run the remaining required Proof cases.",
    }),
  );
  assert.doesNotThrow(() =>
    proofContinue.parse({
      proofId: "proof-1",
      expectedVersion: 1,
      action: "record-runs",
      runIds: ["run-1"],
    }),
  );
  assert.throws(
    () =>
      proofContinue.parse({
        proofId: "proof-1",
        expectedVersion: 1,
        action: "record-runs",
        runIds: ["run-1"],
        verdict: "passed",
      }),
    /Unrecognized key/u,
  );
  assert.throws(
    () =>
      proofContinue.parse({
        proofId: "proof-1",
        expectedVersion: 1,
        action: "start-pilot",
        reason: "Run it.",
        runIds: ["run-1"],
      }),
    /only valid for record-runs/u,
  );
  assert.throws(
    () =>
      proofContinue.parse({
        proofId: "proof-1",
        expectedVersion: 1,
        action: "record-runs",
        runIds: ["run-1"],
        reason: "This cannot become a client verdict.",
      }),
    /only runIds/u,
  );

  const proofRun = operationDefinition("proof.run").input;
  assert.deepEqual(proofRun.parse({ proofId: "proof-1" }), { proofId: "proof-1" });
  assert.deepEqual(proofRun.parse({ proofId: "proof-1", expectedVersion: 2, wait: true }), {
    proofId: "proof-1",
    expectedVersion: 2,
    wait: true,
  });
  assert.throws(() => proofRun.parse({ proofId: "proof-1", cursor: 0 }), /Unrecognized key/u);
});

test("run review can request another human decision without resolving the Run", () => {
  const review = operationDefinition("run.review");
  assert.deepEqual(review.input.parse({ runId: "run-1", action: "defer", note: "Ask Ada" }), {
    runId: "run-1",
    action: "defer",
    note: "Ask Ada",
  });
  assert.throws(
    () => review.input.parse({ runId: "run-1", action: "approve-baseline" }),
    /approve.*reject.*defer/u,
  );
});

test("run list accepts bounded opaque continuation cursors", () => {
  const definition = operationDefinition("run.list");
  assert.deepEqual(definition.input.parse({ limit: "100", cursor: "opaque-page" }), {
    limit: 100,
    cursor: "opaque-page",
  });
  assert.throws(() => definition.input.parse({ cursor: "" }), /run list cursor/u);
  assert.throws(() => definition.input.parse({ cursor: 12 }), /run list cursor/u);
  assert.doesNotThrow(() =>
    definition.output.parse({
      runs: [],
      totalCount: 205,
      nextCursor: "opaque-page",
    }),
  );
});

test("App Map descriptors keep their canonical contiguous order", () => {
  assert.deepEqual(
    operationDefinitions.filter(({ id }) => id.startsWith("app-map.")).map(({ id }) => id),
    [
      "app-map.list",
      "app-map.get",
      "app-map.remove",
      "app-map.create",
      "app-map.duplicate",
      "app-map.export",
      "app-map.import",
      "app-map.update",
      "app-map.commit",
      "app-map.screen.add",
      "app-map.screen.capture",
      "app-map.screen.refresh.prepare",
      "app-map.screen.refresh.apply",
      "app-map.screen.alias-observe",
      "app-map.scroll-surface.capture",
      "app-map.scroll-surface.regenerate",
      "app-map.scroll-surface.origin.inspect",
      "app-map.scroll-surface.origin.review",
      "app-map.scroll-surface.origin.revoke",
      "app-map.teach",
      "app-map.screen.update",
      "app-map.screen.remove",
      "app-map.screen.consolidate",
      "app-map.connection.create",
      "app-map.connection.update",
      "app-map.connection.remove",
      "app-map.group.save",
      "app-map.group.remove",
      "app-map.flow.save",
      "app-map.flow.run",
      "app-map.connection.run",
      "app-map.flow.remove",
      "app-map.case-stack.save",
      "app-map.case-stack.attach",
      "app-map.case-stack.remove",
      "app-map.variable.save",
      "app-map.variable.infer",
      "app-map.variable.remove",
      "app-map.test.save",
      "app-map.test.remove",
      "app-map.test.edit",
      "app-map.test.undo",
      "app-map.test.redo",
      "app-map.test.propose",
      "app-map.test.compile",
      "app-map.test.from-intent",
      "app-map.test.run",
      "app-map.combine.preflight",
      "app-map.combine.save",
      "app-map.combine.remove",
      "app-map.routine.save",
      "app-map.routine.remove",
      "app-map.routine.impact",
      "app-map.diff.impact",
      "app-map.proposal.submit",
      "app-map.observations.propose",
      "app-map.proposal.approve",
      "app-map.proposal.reject",
      "app-map.proposal.revert",
    ],
  );
});

test("durable Test history operations require only an exact revision fence", () => {
  for (const id of ["app-map.test.undo", "app-map.test.redo"] as const) {
    const operation = operationDefinition(id);
    assert.deepEqual(
      operation.input.parse({ appMapId: "map", testId: "test", expectedRevision: 4 }),
      { appMapId: "map", testId: "test", expectedRevision: 4 },
    );
    assert.throws(
      () => operation.input.parse({ appMapId: "map", testId: "test", expectedRevision: -1 }),
      /expectedRevision/u,
    );
    assert.throws(
      () =>
        operation.input.parse({ appMapId: "map", testId: "test", expectedRevision: 4, edits: [] }),
      /Unrecognized key/u,
    );
  }
});

test("alias-observe output carries the approved logical screen variant", () => {
  const output = operationDefinition("app-map.screen.alias-observe").output.parse({
    appMap: {},
    screen: { id: "settings", variantIds: ["variant-browser"] },
    variant: {
      id: "variant-browser",
      screenId: "settings",
      targetProfile: { id: "browser:settings", targetId: "settings-browser" },
    },
    alias: { fingerprint: "a".repeat(64), aliasesNow: ["a".repeat(64)] },
  });
  assert.equal(output.variant.screenId, "settings");
  assert.equal(output.variant.id, "variant-browser");
  assert.throws(
    () =>
      operationDefinition("app-map.screen.alias-observe").output.parse({
        appMap: {},
        alias: { fingerprint: "a".repeat(64), aliasesNow: [] },
      }),
    /screen/u,
  );
});

test("project roles form one explicit least-privilege hierarchy", () => {
  assert.equal(projectRoleAllows("viewer", "viewer"), true);
  assert.equal(projectRoleAllows("viewer", "author"), false);
  assert.equal(projectRoleAllows("author", "viewer"), true);
  assert.equal(projectRoleAllows("author", "runner"), false);
  assert.equal(projectRoleAllows("runner", "author"), true);
  assert.equal(projectRoleAllows("runner", "admin"), false);
  assert.equal(projectRoleAllows("admin", "viewer"), true);
  assert.equal(projectRoleAllows("admin", "admin"), true);
});

test("operation roles keep viewing, authoring, execution, and administration distinct", () => {
  assert.equal(operationDefinition("system.health.get").minimumRole, "viewer");
  assert.equal(operationDefinition("app-map.update").minimumRole, "author");
  assert.equal(operationDefinition("app-map.scroll-surface.origin.inspect").minimumRole, "viewer");
  assert.equal(operationDefinition("app-map.scroll-surface.origin.review").minimumRole, "author");
  assert.equal(operationDefinition("app-map.scroll-surface.origin.revoke").minimumRole, "author");
  assert.equal(operationDefinition("job.start").minimumRole, "runner");
  assert.equal(operationDefinition("run.repair.get").minimumRole, "viewer");
  assert.equal(operationDefinition("run.repair.retry").minimumRole, "runner");
  assert.equal(operationDefinition("authoring.session.interact").minimumRole, "runner");
  assert.equal(operationDefinition("authoring.take.replay").minimumRole, "runner");
  assert.equal(operationDefinition("target.video.start").minimumRole, "runner");
  assert.equal(operationDefinition("workspace.privacy.update").minimumRole, "admin");
  assert.equal(operationDefinition("activity.list").minimumRole, "admin");
  assert.equal(operationDefinition("activity.export").minimumRole, "admin");
  assert.equal(operationDefinition("run.share.list").minimumRole, "admin");
  assert.equal(operationDefinition("run.share.create").minimumRole, "admin");
  assert.equal(operationDefinition("run.share.revoke").minimumRole, "admin");
  assert.equal(operationDefinition("target.delete").minimumRole, "admin");
});

test("selective repair operations require one exact immutable run check", () => {
  assert.deepEqual(
    operationDefinition("run.repair.get").input.parse({ runId: "run-1", checkId: "usage" }),
    { runId: "run-1", checkId: "usage" },
  );
  assert.deepEqual(operationDefinition("run.repair.list").input.parse({ limit: "25" }), {
    limit: 25,
  });
  assert.throws(
    () => operationDefinition("run.repair.retry").input.parse({ runId: "run-1" }),
    /checkId/,
  );
  assert.deepEqual(operationDefinition("run.repair.retry").targetCapabilities, [
    "tap",
    "snapshot",
    "screenshot",
  ]);
  assert.deepEqual(
    operationDefinition("run.repair.propose").input.parse({
      runId: "run-1",
      checkId: "usage",
      kind: "disable",
      reason: "Not applicable to this campaign",
    }),
    {
      runId: "run-1",
      checkId: "usage",
      kind: "disable",
      reason: "Not applicable to this campaign",
    },
  );
});

test("map teach accepts a point tap without expectedRevision", () => {
  const parsed = operationDefinition("app-map.teach").input.parse({
    appMapId: "android-settings-now",
    leaseId: "lease-1",
    target: { kind: "device", platform: "android", targetId: "RQCY104BG8X" },
    fromScreenId: "settings",
    title: "Connections",
    interaction: { kind: "point", x: "540", y: "1275" },
  });
  assert.equal(parsed.appMapId, "android-settings-now");
  assert.equal(parsed.fromScreenId, "settings");
});

test("Variable inference captures one explicit target and returns a reviewable save mutation", () => {
  const definition = operationDefinition("app-map.variable.infer");
  assert.equal(definition.transport.path, "/app-maps/:appMapId/variables/:variableId/infer");
  assert.deepEqual(definition.targetCapabilities, ["snapshot"]);
  assert.equal(definition.lease, "exclusive");
  assert.deepEqual(
    definition.input.parse({
      appMapId: "settings",
      variableId: "language",
      expectedRevision: 4,
      leaseId: "lease-1",
      target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      taughtRows: [{ id: "en", identifier: "language.en" }],
    }),
    {
      appMapId: "settings",
      variableId: "language",
      expectedRevision: 4,
      leaseId: "lease-1",
      target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      taughtRows: [{ id: "en", identifier: "language.en" }],
    },
  );
  assert.throws(
    () =>
      definition.input.parse({
        appMapId: "settings",
        variableId: "language",
        expectedRevision: 4,
        leaseId: "lease-1",
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
        taughtRows: [],
      }),
    /non-empty|min/u,
  );
});

test("screen consolidation validates a read-only preview request", () => {
  const evidence = {
    id: "evidence",
    uri: `relay-evidence://${"a".repeat(64)}`,
    sha256: "a".repeat(64),
    bytes: 1,
  };
  const parsed = operationDefinition("app-map.screen.consolidate").input.parse({
    appMapId: "grok",
    targetScreenId: "settings",
    sourceScreenIds: ["settings-middle", "settings-bottom"],
    expectedRevision: 12,
    dryRun: true,
    targetTitle: "Settings",
    surfaceImport: {
      schemaVersion: 1,
      id: "settings-surface",
      targetProfileId: "pixel",
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "Imported viewports",
        decidedAt: 1,
      },
      message: "Seam remains ambiguous",
      restoredStartViewport: true,
      viewports: [0, 1].map((index) => ({
        index,
        offsetY: index,
        appendedHeight: 1,
        capturedAt: index + 1,
        width: 1,
        height: 1,
        screenshot: { ...evidence, mime: "image/png" },
        accessibilityTree: { ...evidence, mime: "application/json" },
      })),
    },
  });
  assert.deepEqual(parsed.sourceScreenIds, ["settings-middle", "settings-bottom"]);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.targetTitle, "Settings");
  assert.equal(parsed.surfaceImport?.schemaVersion, 1);
  assert.throws(
    () =>
      operationDefinition("app-map.screen.consolidate").input.parse({
        appMapId: "grok",
        targetScreenId: "settings",
        sourceScreenIds: [],
        expectedRevision: 12,
      }),
    /non-empty array/,
  );
});

test("map teach accepts a swipe as a replayable scroll gesture", () => {
  const parsed = operationDefinition("app-map.teach").input.parse({
    appMapId: "android-settings-now",
    leaseId: "lease-1",
    target: { kind: "device", platform: "android", targetId: "RQCY104BG8X" },
    fromScreenId: "settings-top",
    title: "Settings · Middle",
    label: "Scroll settings",
    interaction: {
      kind: "swipe",
      from: { x: 540, y: 1720 },
      to: { x: 540, y: 620 },
      durationMs: 280,
    },
  });
  assert.deepEqual(parsed.interaction, {
    kind: "swipe",
    from: { x: 540, y: 1720 },
    to: { x: 540, y: 620 },
    durationMs: 280,
  });
});

test("map teach accepts only an exact reversible handoff declaration", () => {
  const input = {
    appMapId: "grok",
    leaseId: "lease-1",
    target: { kind: "device" as const, platform: "android" as const, targetId: "phone-1" },
    fromScreenId: "widget",
    title: "Add to home screen",
    interaction: { kind: "label" as const, label: "Add widget" },
    handoff: { expectedApp: "bitpit.launcher", returnAction: "back" as const },
  };
  assert.deepEqual(operationDefinition("app-map.teach").input.parse(input), input);
  assert.throws(
    () =>
      operationDefinition("app-map.teach").input.parse({
        ...input,
        handoff: { expectedApp: "bitpit.launcher", returnAction: "none" },
      }),
    /returnAction/u,
  );
});

test("App Map flow runs accept an explicit replay boundary", () => {
  const input = {
    appMapId: "map-1",
    flowId: "main",
    throughConnectionId: "open-settings",
    serial: "phone-1",
    targetKind: "device" as const,
    platform: "android" as const,
  };
  assert.deepEqual(operationDefinition("app-map.flow.run").input.parse(input), input);
  assert.throws(
    () =>
      operationDefinition("app-map.flow.run").input.parse({
        ...input,
        throughConnectionId: 42,
      }),
    /throughConnectionId/u,
  );
});

test("graph Test runs require an exact revision and explicit target", () => {
  const input = {
    appMapId: "map-1",
    testId: "checkout",
    expectedRevision: 7,
    target: { kind: "device" as const, platform: "android" as const, targetId: "phone-1" },
  };
  assert.deepEqual(operationDefinition("app-map.test.run").input.parse(input), input);
  const freshSurfaceInput = {
    ...input,
    targetProfileId: "pixel-en",
    surfaceCapture: { forceRecaptureScreenIds: ["voice"] },
  };
  assert.deepEqual(
    operationDefinition("app-map.test.run").input.parse(freshSurfaceInput),
    freshSurfaceInput,
  );
  const warmInput = {
    ...input,
    startup: { mode: "verified-checkpoint" as const, screenId: "settings" },
  };
  assert.deepEqual(operationDefinition("app-map.test.run").input.parse(warmInput), warmInput);
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        startup: { mode: "verified-checkpoint" },
      }),
    /startup screenId/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        startup: { mode: "cold", screenId: "settings" },
      }),
    /only valid for verified-checkpoint/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        surfaceCapture: { forceRecaptureScreenIds: [] },
      }),
    /between 1 and 50 screen ids/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        surfaceCapture: { forceRecaptureScreenIds: ["voice", "voice"] },
      }),
    /duplicate screen id voice/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        target: { kind: "browser", platform: "android", targetId: "browser-1" },
      }),
    /kind and platform/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        appMapId: "map-1",
        testId: "checkout",
        target: input.target,
      }),
    /expectedRevision/u,
  );
  const revision = {
    vcs: "git" as const,
    sha: "abc1234def5678",
    prNumber: 42,
    branch: "feature/checkout",
  };
  const withRevision = { ...input, sourceRevision: revision };
  assert.deepEqual(operationDefinition("app-map.test.run").input.parse(withRevision), withRevision);
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        sourceRevision: { ...revision, vcs: "svn" },
      }),
    /vcs/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        sourceRevision: { ...revision, sha: "ABC1234" },
      }),
    /sha/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        sourceRevision: { ...revision, sha: "abc12" },
      }),
    /sha/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        sourceRevision: { ...revision, prNumber: 0 },
      }),
    /prNumber/u,
  );
});

test("graph Test runs accept optional Combine worlds and a capture lens", () => {
  const input = {
    appMapId: "map-1",
    testId: "checkout",
    expectedRevision: 7,
    target: { kind: "device" as const, platform: "android" as const, targetId: "phone-1" },
    in: { language: ["ja", "pt"] },
    lens: "visual" as const,
    executionMode: "pilot" as const,
    cell: "ja",
  };
  assert.deepEqual(operationDefinition("app-map.test.run").input.parse(input), input);
  assert.deepEqual(
    operationDefinition("app-map.test.run").input.parse({
      appMapId: "map-1",
      testId: "checkout",
      expectedRevision: 7,
      target: input.target,
      lens: "failures-only",
    }),
    {
      appMapId: "map-1",
      testId: "checkout",
      expectedRevision: 7,
      target: input.target,
      lens: "failures-only",
    },
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        in: {},
      }),
    /at least one Variable/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        in: { language: [] },
      }),
    /non-empty array/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        in: { "": ["ja"] },
      }),
    /Variable/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        in: { language: ["ja", "ja"] },
      }),
    /duplicate value id ja/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        lens: "screenshots",
      }),
    /visual, smoke/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        executionMode: "blast",
      }),
    /pilot or all/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        startup: { mode: "verified-checkpoint", screenId: "settings" },
      }),
    /cannot be combined with in/u,
  );
  assert.deepEqual(
    operationDefinition("app-map.test.run").input.parse({
      ...input,
      surfaceCapture: { forceRecaptureScreenIds: ["voice"] },
    }),
    {
      ...input,
      surfaceCapture: { forceRecaptureScreenIds: ["voice"] },
    },
  );
});

test("Combine triage requires a case and a review mutation", () => {
  const input = {
    batchId: "campaign-1",
    caseIds: ["cell-en"],
    triageStatus: "investigating" as const,
    assignee: "human:qa",
  };
  assert.deepEqual(operationDefinition("job.combine.campaign.triage").input.parse(input), input);
  assert.throws(
    () =>
      operationDefinition("job.combine.campaign.triage").input.parse({
        batchId: "campaign-1",
        caseIds: ["cell-en"],
      }),
    /triage requires triageStatus or assignee/u,
  );
  assert.throws(
    () =>
      operationDefinition("job.combine.campaign.triage").input.parse({
        ...input,
        triageStatus: "needs-human",
      }),
    /triageStatus/u,
  );
});

test("Repeat continuation accepts an exact App Map revision fence", () => {
  const input = {
    batchId: "repeat-1",
    reviewed: true,
    expectedAppMapRevision: 12,
  };
  assert.deepEqual(operationDefinition("job.combine.campaign.resume").input.parse(input), input);
  assert.throws(
    () =>
      operationDefinition("job.combine.campaign.resume").input.parse({
        ...input,
        expectedAppMapRevision: -1,
      }),
    />=0/u,
  );
});

test("graph Test compilation can preview a verified checkpoint without changing the saved Test", () => {
  const input = {
    appMapId: "map-1",
    testId: "checkout",
    entryCheckpointScreenId: "settings",
    targetProfileId: "ipad-pt-BR",
  };
  assert.deepEqual(operationDefinition("app-map.test.compile").input.parse(input), input);
  assert.throws(
    () =>
      operationDefinition("app-map.test.compile").input.parse({
        ...input,
        entryCheckpointScreenId: 7,
      }),
    /entryCheckpointScreenId/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.compile").input.parse({
        ...input,
        targetProfileId: 7,
      }),
    /targetProfileId/u,
  );
});

test("graph Test proposals accept only bounded semantic edit batches", () => {
  const input = {
    appMapId: "map-1",
    testId: "checkout",
    expectedRevision: 7,
    proposalId: "proposal-checkout",
    title: "Clarify checkout",
    edits: [
      {
        kind: "step.patch",
        stepId: "submit-order",
        patch: { intent: "Submit the reviewed order" },
      },
    ],
  };
  assert.deepEqual(operationDefinition("app-map.test.propose").input.parse(input), input);
  assert.throws(
    () => operationDefinition("app-map.test.propose").input.parse({ ...input, edits: [] }),
    /between 1 and 100 semantic edits/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.propose").input.parse({
        ...input,
        edits: [{ kind: "replace-source", source: "generated code" }],
      }),
    /kind.*unsupported/u,
  );
});

test("recording review exposes one bounded semantic edit command", () => {
  const parse = operationDefinition("authoring.take.edit").input.parse;
  const merge = {
    sessionId: "session-1",
    edit: {
      kind: "merge" as const,
      actionIds: ["tap-menu", "tap-settings"],
      intent: "Open Settings",
    },
  };
  assert.deepEqual(parse(merge), merge);
  assert.deepEqual(
    parse({
      sessionId: "session-1",
      edit: { kind: "split", actionId: "multi-step", atStep: 1 },
    }),
    {
      sessionId: "session-1",
      edit: { kind: "split", actionId: "multi-step", atStep: 1 },
    },
  );
  assert.deepEqual(
    parse({
      sessionId: "session-1",
      edit: { kind: "restore", sourceRevision: 2 },
    }),
    {
      sessionId: "session-1",
      edit: { kind: "restore", sourceRevision: 2 },
    },
  );
  assert.throws(
    () => parse({ sessionId: "session-1", edit: { kind: "restore", sourceRevision: 1.5 } }),
    /sourceRevision/u,
  );
  assert.throws(
    () => parse({ sessionId: "session-1", edit: { kind: "merge", actionIds: ["only-one"] } }),
    /actionIds|array/u,
  );
  assert.throws(
    () => parse({ sessionId: "session-1", edit: { kind: "split", actionId: "a", atStep: 0 } }),
    /atStep|>=1/u,
  );
});

test("snapshot input accepts optional full and stays valid when omitted", () => {
  const parse = operationDefinition("target.snapshot.capture").input.parse;
  assert.deepEqual(parse({ serial: "ipad-1" }), { serial: "ipad-1" });
  assert.deepEqual(parse({ serial: "ipad-1", full: true }), { serial: "ipad-1", full: true });
  assert.deepEqual(parse({ serial: "ipad-1", full: false, visual: true }), {
    serial: "ipad-1",
    full: false,
    visual: true,
  });
  assert.deepEqual(parse({ serial: "ipad-1", interactiveOnly: true }), {
    serial: "ipad-1",
    interactiveOnly: true,
  });
  assert.deepEqual(parse({ serial: "ipad-1", full: "true" }), { serial: "ipad-1", full: true });
  assert.throws(() => parse({ serial: "ipad-1", full: "yes" }), /full/);
});

test("screenshot preview coordinates accept query-string numbers", () => {
  assert.deepEqual(
    operationDefinition("target.screenshot.capture").input.parse({
      serial: "RQCY104BG8X",
      previewX: "540",
      previewY: "1275",
    }),
    { serial: "RQCY104BG8X", previewX: 540, previewY: 1275 },
  );
  assert.doesNotThrow(() =>
    operationDefinition("target.screenshot.capture").input.parse({
      serial: "RQCY104BG8X",
      previewX: 540,
      previewY: 1275,
    }),
  );
  assert.throws(
    () =>
      operationDefinition("target.screenshot.capture").input.parse({
        serial: "RQCY104BG8X",
        previewX: "left",
      }),
    /previewX/,
  );
});

test("target capability outputs keep pixel, semantic, and evidence proofs distinct", () => {
  const readiness = {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at: 100, durationMs: 12 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "unavailable",
      freshness: "unproven",
      reason: "probe-failed",
      lastError: { at: 98, reason: "probe-failed", observedNodeCount: 14, durationMs: 320 },
      nextProbeAt: 15_098,
    },
    evidenceCapture: {
      mode: "evidence",
      state: "proven",
      freshness: "current",
      proof: { at: 100, durationMs: 12 },
    },
  };
  const output = {
    capturedAt: 100,
    nodes: [],
    interactive: [],
    inspectable: false,
    source: "pixels-only",
    screenIdentity: {},
    tree: "Window · Settings",
    readiness,
  };
  assert.deepEqual(operationDefinition("target.snapshot.capture").output.parse(output), output);
  assert.throws(
    () =>
      operationDefinition("target.snapshot.capture").output.parse({
        ...output,
        readiness: {
          ...readiness,
          semanticControl: { ...readiness.semanticControl, mode: "pixels" },
        },
      }),
    /semanticControl mode/u,
  );
  const pixelsOnly = {
    ...output,
    tree: "",
    readiness: {
      ...readiness,
      semanticControl: {
        mode: "accessibility" as const,
        state: "unavailable" as const,
        freshness: "unproven" as const,
        reason: "probe-in-flight" as const,
      },
    },
  };
  assert.deepEqual(
    operationDefinition("target.snapshot.capture").output.parse(pixelsOnly),
    pixelsOnly,
    "a pixels-first iOS observation must remain useful while XCTest has no tree",
  );
  assert.throws(
    () =>
      operationDefinition("target.snapshot.capture").output.parse({
        ...pixelsOnly,
        inspectable: true,
      }),
    /explicitly uninspectable/u,
  );

  const inFlight = {
    ...readiness,
    semanticControl: {
      mode: "accessibility",
      state: "unavailable",
      freshness: "unproven",
      reason: "probe-in-flight",
      lastError: {
        at: 101,
        reason: "probe-in-flight",
        durationMs: 8_000,
        message: "iOS accessibility is still reading this screen after 8000ms.",
      },
    },
  };
  const lifecycle = {
    operation: "snapshot" as const,
    outcome: "in-flight" as const,
    code: "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT" as const,
    attempts: 1 as const,
    repairAttempted: false as const,
    durationMs: 8_000,
    stages: [
      { stage: "preview" as const, outcome: "skipped" as const },
      { stage: "xctest-availability" as const, outcome: "skipped" as const },
      { stage: "accessibility-query" as const, outcome: "in-flight" as const },
      { stage: "repair" as const, outcome: "skipped" as const },
    ],
  };
  assert.deepEqual(
    operationDefinition("target.snapshot.capture").output.parse({
      ...output,
      readiness: inFlight,
      iosSessionLifecycle: lifecycle,
    }),
    { ...output, readiness: inFlight, iosSessionLifecycle: lifecycle },
  );
  assert.throws(
    () =>
      operationDefinition("target.snapshot.capture").output.parse({
        ...output,
        readiness: {
          ...inFlight,
          semanticControl: { ...inFlight.semanticControl, nextProbeAt: 16_101 },
        },
      }),
    /nextProbeAt/u,
  );
  assert.throws(
    () =>
      operationDefinition("target.snapshot.capture").output.parse({
        ...output,
        readiness: inFlight,
        iosSessionLifecycle: {
          ...lifecycle,
          code: "IOS_SESSION_OPERATION_UNAVAILABLE",
        },
      }),
    /code.*outcome/u,
  );
});

test("target recovery exposes durable fence release evidence only as an immutable ready reproof", () => {
  const evidence = (kind: "screenshot" | "snapshot", sha256: string) => ({
    id: `${kind}-${sha256.slice(0, 8)}`,
    kind,
    capturedAt: 12,
    uri: `relay-evidence://${sha256}`,
    sha256,
    bytes: 128,
    mime: kind === "screenshot" ? "image/png" : "application/json",
  });
  const manifestHash = "a".repeat(64);
  const output = {
    recovery: {
      serial: "ipad-1",
      recovered: true,
      ready: true,
      summary: "Relay repaired the target.",
      actions: [],
      session: { status: "restored" as const, detail: "Ready for a fresh proof." },
    },
    recoveryFenceRelease: {
      assignmentId: "interrupted-job-1",
      releasedAt: 12,
      reproofId: `durable-recovery-fence-reproof:${manifestHash}`,
      evidence: {
        manifest: evidence("snapshot", manifestHash),
        screenshotBefore: evidence("screenshot", "b".repeat(64)),
        semanticSnapshot: evidence("snapshot", "c".repeat(64)),
        screenshotAfter: evidence("screenshot", "d".repeat(64)),
      },
    },
  };
  assert.deepEqual(operationDefinition("target.recover").output.parse(output), output);
  assert.deepEqual(
    operationDefinition("target.recover").input.parse({
      serial: "ipad-1",
      recoveryFenceAssignmentId: "interrupted-job-1",
    }),
    { serial: "ipad-1", recoveryFenceAssignmentId: "interrupted-job-1" },
  );
  assert.throws(
    () =>
      operationDefinition("target.recover").input.parse({
        serial: "ipad-1",
        recoveryFenceAssignmentId: "   ",
      }),
    /non-empty identifier/u,
  );
  assert.throws(
    () =>
      operationDefinition("target.recover").output.parse({
        ...output,
        recoveryFenceRelease: {
          ...output.recoveryFenceRelease,
          evidence: {
            ...output.recoveryFenceRelease.evidence,
            manifest: {
              ...output.recoveryFenceRelease.evidence.manifest,
              uri: "relay-evidence://not-content-addressed",
            },
          },
        },
      }),
    /content-addressed Relay evidence/u,
  );
  assert.throws(
    () =>
      operationDefinition("target.recover").output.parse({
        ...output,
        recovery: { ...output.recovery, ready: false },
      }),
    /requires a ready recovered target/u,
  );
});

test("scroll survey has one strict target-operation contract", () => {
  const definition = operationDefinition("target.scroll-survey.capture");
  assert.equal(definition.transport.method, "POST");
  assert.equal(definition.transport.path, "/capture/scroll-survey");
  assert.equal(definition.category, "target");
  assert.equal(definition.lease, "exclusive");
  assert.deepEqual(definition.targetCapabilities, ["scroll", "snapshot", "screenshot"]);
  assert.equal(definition.progress, false);
  assert.equal(definition.cancellable, false);

  assert.deepEqual(definition.input.parse({ serial: "ipad-1", maxScrolls: 4, restore: false }), {
    serial: "ipad-1",
    maxScrolls: 4,
    restore: false,
  });
  assert.deepEqual(
    definition.input.parse({
      serial: "ipad-1",
      dir: "/tmp/settings",
      force: true,
    }),
    {
      serial: "ipad-1",
      dir: "/tmp/settings",
      force: true,
    },
  );
  for (const input of [
    { serial: "" },
    { serial: "   " },
    { serial: "ipad-1", maxScrolls: 0 },
    { serial: "ipad-1", maxScrolls: 13 },
    { serial: "ipad-1", maxScrolls: 1.5 },
    { serial: "ipad-1", maxScrolls: "4" },
    { serial: "ipad-1", restore: "false" },
    { serial: "ipad-1", dir: "" },
    { serial: "ipad-1", dir: "   " },
    { serial: "ipad-1", force: "true" },
  ]) {
    assert.throws(() => definition.input.parse(input), /scroll survey/u);
  }

  const validOutput = {
    status: "stopped",
    reason: "inspection-unavailable",
    frames: [
      {
        index: 0,
        offsetY: 0,
        screenshot: { base64: "png", width: 834, height: 1112, capturedAt: 1 },
        snapshot: {
          serial: "ipad-1",
          capturedAt: 2,
          nodes: [],
          interactive: [],
          inspectable: false,
          source: "pixels-only",
          screenIdentity: {},
        },
        appendedHeight: 0,
      },
    ],
    diagnosticFrames: [],
    mergedNodes: [],
    restoredStartViewport: true,
    message: "Accessibility is unavailable; no scroll survey was started.",
  };
  assert.deepEqual(definition.output.parse(validOutput), validOutput);
  assert.deepEqual(definition.output.parse({ ...validOutput, reason: "start-viewport-unproven" }), {
    ...validOutput,
    reason: "start-viewport-unproven",
  });
  assert.deepEqual(definition.output.parse({ ...validOutput, reason: "extent-unproven" }), {
    ...validOutput,
    reason: "extent-unproven",
  });
  const persisted = {
    ...validOutput,
    persist: {
      dir: "/tmp/settings",
      status: "stopped" as const,
      reason: "inspection-unavailable",
      frameCount: 1,
      paths: [{ png: "/tmp/settings/00.png", json: "/tmp/settings/00.json" }],
      frames: [
        {
          index: 0,
          offsetY: 0,
          labelCount: 0,
          files: { png: "/tmp/settings/00.png", json: "/tmp/settings/00.json" },
        },
      ],
      full: {
        png: "/tmp/settings/full.png",
        json: "/tmp/settings/full.json",
        width: 834,
        height: 1112,
        nodeCount: 0,
      },
    },
  };
  assert.deepEqual(definition.output.parse(persisted), persisted);
  assert.throws(
    () => definition.output.parse({ ...validOutput, reason: "unknown" }),
    /scroll survey reason/u,
  );
  assert.throws(
    () => definition.output.parse({ ...validOutput, persist: { dir: "" } }),
    /scroll survey persist/u,
  );
});

test("app launch reports the observed foreground app", () => {
  const definition = operationDefinition("target.app.launch");
  assert.deepEqual(definition.input.parse({ serial: "pixel-1", app: "Chrome" }), {
    serial: "pixel-1",
    app: "Chrome",
  });
  const matched = {
    launched: {
      serial: "pixel-1",
      app: "Chrome",
      platform: "android" as const,
      launchedAt: 1,
    },
    observed: { app: "Chrome", matched: true },
  };
  assert.deepEqual(definition.output.parse(matched), matched);
  const bounced = {
    launched: matched.launched,
    observed: { app: "Settings", matched: false },
  };
  assert.deepEqual(definition.output.parse(bounced), bounced);
  assert.deepEqual(
    definition.output.parse({
      launched: matched.launched,
      observed: { matched: false },
    }),
    { launched: matched.launched, observed: { matched: false } },
  );
  assert.throws(() => definition.output.parse({ launched: matched.launched }), /observed/u);
  assert.throws(
    () =>
      definition.output.parse({
        launched: matched.launched,
        observed: { app: "Settings", matched: "false" },
      }),
    /observed/u,
  );
});

test("app locale set is one verified per-app locale mutation", () => {
  const definition = operationDefinition("target.app.locale.set");
  assert.equal(definition.transport.method, "POST");
  assert.equal(definition.transport.path, "/device/app/locale");
  assert.equal(definition.category, "target");
  assert.equal(definition.lease, "exclusive");
  assert.equal(definition.idempotency, "inherent");

  assert.deepEqual(
    definition.input.parse({ serial: "pixel-1", package: "ai.x.grok", locale: "he" }),
    {
      serial: "pixel-1",
      package: "ai.x.grok",
      locale: "he",
    },
  );
  for (const input of [
    { serial: "", package: "ai.x.grok", locale: "he" },
    { serial: "pixel-1", package: "", locale: "he" },
    { serial: "pixel-1", package: "ai.x.grok", locale: "" },
  ]) {
    assert.throws(() => definition.input.parse(input), /target app locale set/u);
  }

  const validOutput = { packageName: "ai.x.grok", locale: "he", observedLocale: "iw" };
  assert.deepEqual(definition.output.parse(validOutput), validOutput);
  assert.deepEqual(definition.output.parse({ packageName: "ai.x.grok", locale: "he" }), {
    packageName: "ai.x.grok",
    locale: "he",
  });
  assert.throws(
    () => definition.output.parse({ packageName: "ai.x.grok", locale: "he", observedLocale: 7 }),
    /target app locale set observed locale/u,
  );
});

test("durable scroll surfaces target exactly one App Map Screen Variant", () => {
  const definition = operationDefinition("app-map.scroll-surface.capture");
  assert.equal(definition.transport.method, "POST");
  assert.equal(
    definition.transport.path,
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/capture",
  );
  assert.equal(definition.category, "authoring");
  assert.equal(definition.lease, "exclusive");
  assert.deepEqual(definition.targetCapabilities, ["scroll", "snapshot", "screenshot"]);
  const input = {
    appMapId: "map-1",
    screenId: "settings",
    variantId: "settings-ja",
    expectedRevision: 12,
    target: { kind: "device", platform: "ios", targetId: "ipad-1" },
    leaseId: "lease-1",
    maxScrolls: 6,
  };
  assert.deepEqual(definition.input.parse(input), input);
  assert.throws(
    () => definition.input.parse({ ...input, target: { ...input.target, kind: "browser" } }),
    /Android or iOS device/u,
  );
  assert.throws(() => definition.input.parse({ ...input, maxScrolls: 13 }), /between 1 and 12/u);

  const regenerate = operationDefinition("app-map.scroll-surface.regenerate");
  assert.equal(regenerate.lease, "none");
  assert.equal(regenerate.targetCapabilities.length, 0);
  const regenerationInput = {
    appMapId: "map-1",
    screenId: "settings",
    variantId: "settings-ja",
    captureId: "capture-1",
    expectedRevision: 13,
  };
  assert.deepEqual(regenerate.input.parse(regenerationInput), regenerationInput);

  const inspection = operationDefinition("app-map.scroll-surface.origin.inspect");
  assert.equal(inspection.lease, "none");
  assert.deepEqual(inspection.targetCapabilities, []);
  const scope = {
    appMapId: "map-1",
    screenId: "settings",
    variantId: "settings-ja",
    captureId: "capture-1",
  };
  assert.deepEqual(inspection.input.parse(scope), scope);

  const review = operationDefinition("app-map.scroll-surface.origin.review");
  assert.equal(review.lease, "none");
  assert.equal(review.confirmation, "confirm");
  assert.deepEqual(review.targetCapabilities, []);
  const decision = {
    ...scope,
    expectedRevision: 13,
    reason: "Reviewed immutable first viewport.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
    confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  };
  assert.deepEqual(review.input.parse(decision), decision);
  assert.throws(
    () => review.input.parse({ ...decision, assertion: "not-reviewed-document-top" }),
    /assertion/u,
  );
  assert.throws(
    () => review.input.parse({ ...decision, assertion: " reviewed-document-top " }),
    /assertion/u,
  );
  assert.throws(() => review.input.parse({ ...decision, confirmation: "no" }), /confirmation/u);

  const revoke = operationDefinition("app-map.scroll-surface.origin.revoke");
  assert.equal(revoke.lease, "none");
  assert.equal(revoke.confirmation, "confirm");
  assert.deepEqual(revoke.targetCapabilities, []);
  const revocation = {
    ...scope,
    expectedRevision: 13,
    reason: "Revoked after reviewing the immutable first viewport.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
    confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  };
  assert.deepEqual(revoke.input.parse({ ...revocation, projectionId: "reviewed-origin-1" }), {
    ...revocation,
    projectionId: "reviewed-origin-1",
  });
});

test("runtime parsers reject malformed input and output", () => {
  assert.throws(
    () => operationDefinition("job.start").input.parse({ serial: "device" }),
    /job recipe/,
  );
  const providerTarget = {
    schemaVersion: 1,
    kind: "provider-session",
    provider: { key: "relay.test.provider", scope: "remote" },
    targetId: "session-42",
    platform: "ios",
    identity: { kind: "provider-session", value: "session-42" },
  } as const;
  assert.deepEqual(
    operationDefinition("job.start").input.parse({
      recipe: "provider-smoke",
      executionTarget: providerTarget,
    }),
    { recipe: "provider-smoke", executionTarget: providerTarget },
  );
  assert.throws(
    () =>
      operationDefinition("job.start").input.parse({
        recipe: "provider-smoke",
        executionTarget: { ...providerTarget, targetId: "different-session" },
      }),
    /job executionTarget/,
  );
  assert.deepEqual(
    operationDefinition("run.share.create").input.parse({
      runId: "run-1",
      expiresInHours: "24",
      includeBatch: true,
    }),
    { runId: "run-1", expiresInHours: 24, includeBatch: true },
  );
  assert.throws(
    () =>
      operationDefinition("run.share.create").input.parse({
        runId: "run-1",
        expiresInHours: 900,
      }),
    /30 days/u,
  );
  assert.throws(
    () => operationDefinition("target.screenshot.capture").output.parse({ path: "shot.png" }),
    /screenshot base64/,
  );
  assert.throws(
    () => operationDefinition("system.health.get").output.parse({ ok: true }),
    /health/,
  );
  assert.throws(
    () =>
      operationDefinition("lease.takeover").input.parse({
        leaseId: "lease-one",
        expiresAt: Date.now() + 60_000,
        reason: "User delegated control",
        confirm: false,
      }),
    /confirm/u,
  );
  assert.deepEqual(
    operationDefinition("lease.takeover").input.parse({
      leaseId: "lease-one",
      reason: "User approved the handoff",
      confirm: true,
    }),
    { leaseId: "lease-one", reason: "User approved the handoff", confirm: true },
  );
  assert.deepEqual(
    operationDefinition("lease.create").input.parse({
      poolId: "local",
      deviceSerial: "ipad-1",
    }),
    { poolId: "local", deviceSerial: "ipad-1" },
  );
  assert.throws(
    () =>
      operationDefinition("lease.create").input.parse({
        poolId: "local",
        deviceSerial: "ipad-1",
        expiresAt: -1,
      }),
    /expiresAt/u,
  );
});

test("authoring interactions expose system controls without opaque custom steps", () => {
  const parse = operationDefinition("authoring.session.interact").input.parse;
  assert.deepEqual(
    parse({
      sessionId: "session-a",
      interaction: {
        kind: "clipboard",
        action: "paste",
        text: "hello\nworld",
        target: { identifier: "chat_text_input" },
      },
    }),
    {
      sessionId: "session-a",
      interaction: {
        kind: "clipboard",
        action: "paste",
        text: "hello\nworld",
        target: { identifier: "chat_text_input" },
      },
    },
  );
  assert.deepEqual(
    parse({ sessionId: "session-a", interaction: { kind: "app", action: "switcher" } }),
    { sessionId: "session-a", interaction: { kind: "app", action: "switcher" } },
  );
  assert.deepEqual(
    parse({
      sessionId: "session-a",
      interaction: { kind: "device", action: "keyboard-enter" },
    }),
    { sessionId: "session-a", interaction: { kind: "device", action: "keyboard-enter" } },
  );
  assert.throws(
    () => parse({ sessionId: "session-a", interaction: { kind: "device", action: "volume-up" } }),
    /device action/u,
  );
});

test("capability manifest is serializable and contains no parser functions", () => {
  const manifest = operationManifest();
  const roundTrip = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
  assert.equal(roundTrip.length, operationDefinitions.length);
  assert.equal(roundTrip[0]?.id, "system.health.get");
  assert.equal(typeof roundTrip[0]?.input, "string");
});

test("offline run replay is a frozen-evidence response, not a live run job", () => {
  const definition = operationDefinition("run.replay.offline");
  assert.deepEqual(definition.input.parse({ runId: "run-1" }), { runId: "run-1" });
  assert.doesNotThrow(() =>
    definition.output.parse({
      report: {
        schemaVersion: 1,
        mode: "offline-evidence-replay",
        runId: "run-1",
        sourceRunStatus: "error",
        planDigest: "a".repeat(64),
        summary: {
          checks: 40,
          proved: 38,
          rootFailures: 1,
          invalidCascades: 1,
          independentFailures: 0,
        },
        cursorTimeline: [],
        checks: [],
        blockers: [],
      },
    }),
  );
  assert.throws(
    () =>
      definition.output.parse({
        report: { schemaVersion: 1, mode: "live-replay", runId: "run-1" },
      }),
    /offline-evidence-replay/,
  );
});

test("live replay mode is explicit and validated", () => {
  const definition = operationDefinition("run.replay");
  assert.deepEqual(definition.input.parse({ runId: "run-1" }), { runId: "run-1" });
  assert.deepEqual(definition.input.parse({ runId: "run-1", mode: "same-configuration" }), {
    runId: "run-1",
    mode: "same-configuration",
  });
  assert.throws(
    () => definition.input.parse({ runId: "run-1", mode: "current-build" }),
    /replay mode/u,
  );
});

test("TracePack export is a persisted-run evidence query with a strict response", () => {
  const definition = operationDefinition("run.trace-pack.get");
  assert.deepEqual(definition.input.parse({ runId: "run-1" }), { runId: "run-1" });
  assert.deepEqual(definition.transport, { method: "GET", path: "/runs/:runId/trace-pack" });
  assert.equal(definition.minimumRole, "viewer");
  assert.throws(() => definition.output.parse({ tracePack: {}, analysis: {} }));
});

test("standalone step output keeps an unknown iOS command as terminal review evidence", () => {
  const definition = operationDefinition("step.run");
  const result = {
    ok: false,
    terminal: "review-needed",
    error: "The iOS press may already have reached the device.",
    durationMs: 12,
    logs: ["native command issued once"],
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    iosMutation: {
      sequence: 1,
      operation: "press",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: { attempts: 0, decision: "blocked", reason: "native-command-outcome-unknown" },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      cancellation: { observedAfterAttemptStarted: true },
      at: 1,
    },
    stepReview: {
      captureCurrent: {
        operationId: "target.screenshot.capture",
        input: { serial: "ipad-1" },
      },
    },
  };

  assert.deepEqual(definition.output.parse(result), result);
  assert.throws(() => definition.output.parse({ ...result, terminal: "failed" }), /review-needed/);
  assert.throws(
    () =>
      definition.output.parse({
        ...result,
        stepReview: {
          captureCurrent: { operationId: "target.interact", input: { serial: "ipad-1" } },
        },
      }),
    /target screenshot/,
  );
  assert.throws(
    () =>
      definition.output.parse({
        ...result,
        iosMutation: {
          ...result.iosMutation,
          cancellation: { observedAfterAttemptStarted: false },
        },
      }),
    /cancellation observedAfterAttemptStarted/,
  );
});

test("descriptor invariants catch duplicates and unsafe cancellation metadata", () => {
  const first = operationDefinitions[0]!;
  assert.throws(
    () => validateOperationDefinitions([first, { ...first }] as OperationDefinition[]),
    /Duplicate operation id/,
  );
  assert.throws(
    () =>
      validateOperationDefinitions([
        {
          ...first,
          id: "invalid.cancel",
          transport: { method: "POST", path: "/invalid/cancel" },
          mode: "command",
          cancellable: true,
          progress: false,
        },
      ]),
    /does not report progress/,
  );
  assert.throws(
    () =>
      validateOperationDefinitions([
        { ...first, minimumRole: "superuser" as OperationDefinition["minimumRole"] },
      ]),
    /unsupported minimum role/,
  );
});

// Compile-time contract: known operation inputs are inferred from the registry map.
const validInput: OperationInput<"job.start"> = { recipe: "smoke" };
assert.equal(validInput.recipe, "smoke");

test("full-page recording flags survive the canonical interaction schema", () => {
  const input = {
    sessionId: "authoring-full-page",
    interaction: { kind: "screenshot", fullPage: true, label: "Capture full page" },
  };
  assert.deepEqual(operationDefinition("authoring.session.interact").input.parse(input), input);
});

test("recording insertion reuses the validated interaction contract", () => {
  const input = {
    sessionId: "session",
    edit: {
      kind: "insert-before",
      actionId: "stop",
      interaction: {
        kind: "steps",
        label: "Wait for timer",
        steps: [{ kind: "wait-for", target: { label: "Stop" }, timeoutMs: 10000 }],
      },
    },
  };
  assert.deepEqual(operationDefinition("authoring.take.edit").input.parse(input), input);
  assert.throws(() =>
    operationDefinition("authoring.take.edit").input.parse({
      ...input,
      edit: { ...input.edit, actionId: "" },
    }),
  );
  assert.throws(() =>
    operationDefinition("authoring.take.edit").input.parse({
      ...input,
      edit: { ...input.edit, interaction: { kind: "unsupported" } },
    }),
  );
});
