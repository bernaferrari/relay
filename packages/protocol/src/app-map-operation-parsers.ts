import type { AppMap } from "./app-map.js";
import { validateAppMapRunInput } from "./app-map-operation-run-parser.js";
import { createAppMapReviewedOriginParsers } from "./app-map-reviewed-origin-parsers.js";
import { createAppMapTestRunParsers } from "./app-map-test-run-parsers.js";
import type { AppMapOperationMap } from "./app-map-operation-map.js";
import type { OperationRecord, RuntimeParser } from "./operation-contract.js";

type AppMapOperationId = keyof AppMapOperationMap;
type AppMapOperationInput<Id extends AppMapOperationId> = AppMapOperationMap[Id]["input"];
type AppMapOperationOutput<Id extends AppMapOperationId> = AppMapOperationMap[Id]["output"];

export type AppMapParserDependencies = {
  emptyInputParser: RuntimeParser<Record<string, never>>;
  okParser: RuntimeParser<{ ok: true }>;
  fail(label: string, message: string): never;
  record(value: unknown, label: string): OperationRecord;
  string(value: unknown, label: string): string;
  number(value: unknown, label: string): number;
  boolean(value: unknown, label: string): boolean;
  objectParser<T extends OperationRecord>(
    description: string,
    validate?: (input: OperationRecord) => void,
  ): RuntimeParser<T>;
  objectFieldParser<T extends OperationRecord>(
    description: string,
    field: keyof T & string,
  ): RuntimeParser<T>;
};

export function createAppMapOperationParsers(dependencies: AppMapParserDependencies) {
  const { boolean, fail, number, objectFieldParser, objectParser, record, string } = dependencies;
  const testRunParsers = createAppMapTestRunParsers(dependencies);
  const reviewedOriginParsers = createAppMapReviewedOriginParsers(dependencies);
  const appMapRefParser = objectParser<{ appMapId: string }>("App Map reference", (input) => {
    string(input.appMapId, "App Map id");
  });

  const appMapCreateParser = objectParser<AppMapOperationInput<"app-map.create">>(
    "App Map creation",
    (input) => {
      string(input.appMapId, "App Map id");
      string(input.name, "App Map name");
    },
  );

  const appMapDuplicateParser = objectParser<AppMapOperationInput<"app-map.duplicate">>(
    "App Map duplication",
    (input) => {
      string(input.sourceAppMapId, "Source App Map id");
      string(input.appMapId, "Duplicate App Map id");
      if (input.name !== undefined) string(input.name, "Duplicate App Map name");
    },
  );

  const appMapImportParser = objectParser<AppMapOperationInput<"app-map.import">>(
    "App Map import",
    (input) => {
      string(input.yaml, "App Map YAML");
      if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") {
        fail("App Map import dryRun", "must be boolean");
      }
      if (
        input.conflict !== undefined &&
        input.conflict !== "reject" &&
        input.conflict !== "replace" &&
        input.conflict !== "copy"
      ) {
        fail("App Map import conflict", "must be reject, replace, or copy");
      }
    },
  );

  const appMapExportParser = objectParser<AppMapOperationOutput<"app-map.export">>(
    "App Map export response",
    (input) => {
      record(input.appMap, "exported App Map");
      string(input.yaml, "exported App Map YAML");
      string(input.filename, "exported App Map filename");
    },
  );

  const appMapImportOutputParser = objectParser<AppMapOperationOutput<"app-map.import">>(
    "App Map import response",
    (input) => {
      record(input.appMap, "imported App Map");
      if (typeof input.imported !== "boolean") fail("App Map imported", "must be boolean");
    },
  );

  const appMapFlowRunParser = objectParser<AppMapOperationInput<"app-map.flow.run">>(
    "App Map flow run input",
    (input) => {
      string(input.appMapId, "App Map flow run appMapId");
      string(input.flowId, "App Map flow run flowId");
      if (input.throughConnectionId !== undefined) {
        string(input.throughConnectionId, "App Map flow run throughConnectionId");
      }
      validateAppMapRunInput(input, dependencies, "App Map flow run");
    },
  );

  const appMapFlowRunOutputParser = objectParser<AppMapOperationOutput<"app-map.flow.run">>(
    "App Map flow run response",
    (input) => {
      record(input.job, "App Map flow run job");
      if (!Array.isArray(input.jobs)) fail("App Map flow run jobs", "must be an array");
      record(input.plan, "App Map flow run plan");
      if (input.matrix !== undefined) record(input.matrix, "App Map flow combine");
    },
  );

  const appMapConnectionRunParser = objectParser<AppMapOperationInput<"app-map.connection.run">>(
    "App Map connection run input",
    (input) => {
      string(input.appMapId, "App Map connection run appMapId");
      string(input.connectionId, "App Map connection run connectionId");
      validateAppMapRunInput(input, dependencies, "App Map connection run");
    },
  );

  const appMapConnectionRunOutputParser = objectParser<
    AppMapOperationOutput<"app-map.connection.run">
  >("App Map connection run response", (input) => {
    record(input.job, "App Map connection run job");
    if (!Array.isArray(input.jobs)) fail("App Map connection run jobs", "must be an array");
    record(input.plan, "App Map connection run plan");
    if (input.matrix !== undefined) record(input.matrix, "App Map connection combine");
  });

  function appMapMutationParser<Id extends AppMapOperationId>(
    description: string,
    nested?: string,
    requiredIds: readonly string[] = [],
  ): RuntimeParser<AppMapOperationInput<Id>> {
    return objectParser<AppMapOperationInput<Id>>(description, (input) => {
      string(input.appMapId, `${description} appMapId`);
      number(input.expectedRevision, `${description} expectedRevision`);
      if (input.eventId !== undefined) string(input.eventId, `${description} eventId`);
      for (const field of requiredIds) string(input[field], `${description} ${field}`);
      if (nested) record(input[nested], `${description} ${nested}`);
    });
  }

  const appMapProposalApproveParser = objectParser<
    AppMapOperationInput<"app-map.proposal.approve">
  >("proposal approval", (input) => {
    string(input.appMapId, "proposal approval appMapId");
    number(input.expectedRevision, "proposal approval expectedRevision");
    string(input.proposalId, "proposal approval proposalId");
    if (input.eventId !== undefined) string(input.eventId, "proposal approval eventId");
    if (input.reason !== undefined) string(input.reason, "proposal approval reason");
    if (input.serial !== undefined) string(input.serial, "proposal approval serial");
    if (input.prove !== undefined) boolean(input.prove, "proposal approval prove");
  });

  const appMapScreenAddParser = objectParser<AppMapOperationInput<"app-map.screen.add">>(
    "screen addition",
    (input) => {
      string(input.appMapId, "screen addition appMapId");
      number(input.expectedRevision, "screen addition expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "screen addition eventId");
      const screen = record(input.screen, "screen addition screen");
      string(screen.id, "screen addition screen id");
      string(screen.title, "screen addition screen title");
      if (screen.description !== undefined)
        string(screen.description, "screen addition description");
      if (screen.identity !== undefined) record(screen.identity, "screen addition identity");
      if (screen.position !== undefined) record(screen.position, "screen addition position");
    },
  );

  const appMapConnectionCreateParser = objectParser<
    AppMapOperationInput<"app-map.connection.create">
  >("connection creation", (input) => {
    string(input.appMapId, "connection creation appMapId");
    number(input.expectedRevision, "connection creation expectedRevision");
    if (input.eventId !== undefined) string(input.eventId, "connection creation eventId");
    const connection = record(input.connection, "connection creation connection");
    string(connection.id, "connection creation id");
    string(connection.fromScreenId, "connection creation fromScreenId");
    const destination = record(connection.destination, "connection creation destination");
    if (destination.kind !== "screen" && destination.kind !== "end") {
      fail("connection creation destination kind", "must be screen or end");
    }
    if (destination.kind === "screen") {
      string(destination.screenId, "connection creation destination screenId");
    }
    if (connection.label !== undefined) string(connection.label, "connection creation label");
    if (connection.caseStackId !== undefined)
      string(connection.caseStackId, "connection creation caseStackId");
    if (
      connection.state !== undefined &&
      connection.state !== "draft" &&
      connection.state !== "ready"
    ) {
      fail("connection creation state", "must be draft or ready");
    }
    if (connection.actions !== undefined && !Array.isArray(connection.actions)) {
      fail("connection creation actions", "must be an array");
    }
  });

  const appMapFlowSaveParser = objectParser<AppMapOperationInput<"app-map.flow.save">>(
    "Flow save",
    (input) => {
      string(input.appMapId, "Flow save appMapId");
      string(input.flowId, "Flow save flowId");
      number(input.expectedRevision, "Flow save expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "Flow save eventId");
      const flow = record(input.flow, "Flow save flow");
      string(flow.name, "Flow save name");
      string(flow.startScreenId, "Flow save startScreenId");
      if (flow.setup !== undefined) {
        const setup = record(flow.setup, "Flow save setup");
        string(setup.routineId, "Flow save setup routineId");
        if (setup.bindings !== undefined) record(setup.bindings, "Flow save setup bindings");
      }
      if (!Array.isArray(flow.connectionIds)) fail("Flow save connectionIds", "must be an array");
      for (const connectionId of flow.connectionIds as unknown[]) {
        string(connectionId, "Flow save connectionId");
      }
    },
  );

  const appMapRoutineSaveParser = objectParser<AppMapOperationInput<"app-map.routine.save">>(
    "Routine save",
    (input) => {
      string(input.appMapId, "Routine save appMapId");
      string(input.routineId, "Routine save routineId");
      number(input.expectedRevision, "Routine save expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "Routine save eventId");
      const routine = record(input.routine, "Routine save routine");
      string(routine.name, "Routine save name");
      if (routine.description !== undefined)
        string(routine.description, "Routine save description");
      if (routine.parameters !== undefined && !Array.isArray(routine.parameters)) {
        fail("Routine save parameters", "must be an array");
      }
      if (!Array.isArray(routine.actions)) fail("Routine save actions", "must be an array");
    },
  );

  const appMapOutputParser = objectFieldParser<{ appMap: AppMap }>("App Map response", "appMap");
  const appMapListOutputParser = objectParser<AppMapOperationOutput<"app-map.list">>(
    "App Maps response",
    (output) => {
      if (!Array.isArray(output.appMaps)) fail("App Maps response appMaps", "must be an array");
      const degradedEntries: unknown = output.degraded;
      if (degradedEntries === undefined) return;
      if (!Array.isArray(degradedEntries)) {
        fail("App Maps response degraded", "must be an array");
      }
      for (const item of degradedEntries as unknown[]) {
        const degraded = record(item, "App Maps response degraded item");
        string(degraded.key, "App Maps response degraded key");
        string(degraded.error, "App Maps response degraded error");
        if (degraded.id !== undefined) string(degraded.id, "App Maps response degraded id");
        if (degraded.disposition !== undefined) {
          if (degraded.disposition !== "read-only" && degraded.disposition !== "quarantined") {
            fail("App Maps response degraded disposition", "must be read-only or quarantined");
          }
        }
      }
    },
  );
  const appMapCombinePreflightInputParser = objectParser<
    AppMapOperationInput<"app-map.combine.preflight">
  >("Combine preflight", (input) => {
    string(input.appMapId, "Combine preflight appMapId");
    string(input.combineId, "Combine preflight combineId");
    if (input.serial !== undefined) string(input.serial, "Combine preflight serial");
    if (input.browserTargetId !== undefined) {
      string(input.browserTargetId, "Combine preflight browserTargetId");
    }
    if (input.targetProfileId !== undefined) {
      string(input.targetProfileId, "Combine preflight targetProfileId");
    }
    if (
      input.targetKind !== undefined &&
      input.targetKind !== "device" &&
      input.targetKind !== "browser"
    ) {
      fail("Combine preflight targetKind", "must be device or browser");
    }
    if (input.platform !== undefined && input.platform !== "android" && input.platform !== "ios") {
      fail("Combine preflight platform", "must be android or ios");
    }
    if (input.selected !== undefined) record(input.selected, "Combine preflight selected");
    if (
      input.strategy !== undefined &&
      input.strategy !== "zip" &&
      input.strategy !== "cartesian" &&
      input.strategy !== "pairwise"
    ) {
      fail("Combine preflight strategy", "must be zip, cartesian, or pairwise");
    }
    if (input.profileTargets !== undefined) {
      if (!Array.isArray(input.profileTargets)) {
        fail("Combine preflight profileTargets", "must be an array");
      }
    }
  });
  const appMapCombinePreflightOutputParser = objectParser<
    AppMapOperationOutput<"app-map.combine.preflight">
  >("Combine preflight response", (input) => {
    record(input.preflight, "Combine preflight response preflight");
    if (input.accountCapacity !== undefined) {
      record(input.accountCapacity, "Combine preflight response accountCapacity");
    }
  });

  const appMapScreenCaptureParser = objectParser<AppMapOperationInput<"app-map.screen.capture">>(
    "App Map screen capture",
    (input) => {
      string(input.appMapId, "App Map screen capture appMapId");
      number(input.expectedRevision, "App Map screen capture expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "App Map screen capture eventId");
      string(input.leaseId, "App Map screen capture leaseId");
      const target = record(input.target, "App Map screen capture target");
      if (target.kind !== "device" && target.kind !== "browser") {
        fail("App Map screen capture target kind", "must be device or browser");
      }
      if (
        target.platform !== "android" &&
        target.platform !== "ios" &&
        target.platform !== "browser"
      ) {
        fail("App Map screen capture target platform", "must be android, ios, or browser");
      }
      string(target.targetId, "App Map screen capture targetId");
      if (input.title !== undefined) string(input.title, "App Map screen capture title");
      if (input.authenticationFixtureReference !== undefined) {
        string(
          input.authenticationFixtureReference,
          "App Map screen capture authenticationFixtureReference",
        );
      }
      if (input.position !== undefined) {
        const position = record(input.position, "App Map screen capture position");
        number(position.x, "App Map screen capture position x");
        number(position.y, "App Map screen capture position y");
      }
    },
  );

  const appMapScreenRefreshPrepareParser = objectParser<
    AppMapOperationInput<"app-map.screen.refresh.prepare">
  >("Screen refresh prepare", (input) => {
    appMapScreenCaptureParser.parse(input);
    string(input.screenId, "Screen refresh screenId");
  });
  const appMapScreenRefreshApplyParser = objectParser<
    AppMapOperationInput<"app-map.screen.refresh.apply">
  >("Screen refresh apply", (input) => {
    string(input.appMapId, "Screen refresh appMapId");
    string(input.screenId, "Screen refresh screenId");
    number(input.expectedRevision, "Screen refresh expectedRevision");
    string(input.token, "Screen refresh token");
  });
  const appMapScreenRefreshPrepareOutputParser = objectParser<
    AppMapOperationOutput<"app-map.screen.refresh.prepare">
  >("Screen refresh preview", (output) => {
    string(output.token, "Screen refresh token");
    string(output.screenshotUri, "Screen refresh screenshotUri");
    number(output.expiresAt, "Screen refresh expiresAt");
  });
  const appMapScreenRefreshApplyOutputParser = objectParser<
    AppMapOperationOutput<"app-map.screen.refresh.apply">
  >("Screen refresh result", (output) => {
    record(output.appMap, "Screen refresh appMap");
    record(output.screen, "Screen refresh screen");
    record(output.variant, "Screen refresh variant");
  });

  const appMapScreenAliasObserveParser = objectParser<
    AppMapOperationInput<"app-map.screen.alias-observe">
  >("App Map screen alias observation", (input) => {
    string(input.appMapId, "App Map screen alias observation appMapId");
    string(input.screenId, "App Map screen alias observation screenId");
    number(input.expectedRevision, "App Map screen alias observation expectedRevision");
    if (input.eventId !== undefined)
      string(input.eventId, "App Map screen alias observation eventId");
    string(input.leaseId, "App Map screen alias observation leaseId");
    const target = record(input.target, "App Map screen alias observation target");
    if (target.kind !== "device" && target.kind !== "browser") {
      fail("App Map screen alias observation target kind", "must be device or browser");
    }
    if (
      target.platform !== "android" &&
      target.platform !== "ios" &&
      target.platform !== "browser"
    ) {
      fail("App Map screen alias observation target platform", "must be android, ios, or browser");
    }
    string(target.targetId, "App Map screen alias observation targetId");
  });

  const appMapScreenAliasObserveOutputParser = objectParser<
    AppMapOperationOutput<"app-map.screen.alias-observe">
  >("App Map screen alias observation response", (output) => {
    record(output.appMap, "App Map screen alias observation response appMap");
    record(output.screen, "App Map screen alias observation response screen");
    record(output.variant, "App Map screen alias observation response variant");
    const alias = record(output.alias, "App Map screen alias observation response alias");
    string(alias.fingerprint, "App Map screen alias observation response alias fingerprint");
    if (!Array.isArray(alias.aliasesNow)) {
      fail("App Map screen alias observation response alias aliasesNow", "must be an array");
    }
    for (const entry of alias.aliasesNow as unknown[]) {
      string(entry, "App Map screen alias observation response alias aliasesNow entry");
    }
  });

  const appMapVariableInferParser = objectParser<AppMapOperationInput<"app-map.variable.infer">>(
    "App Map Variable inference",
    (input) => {
      string(input.appMapId, "App Map Variable inference appMapId");
      string(input.variableId, "App Map Variable inference variableId");
      number(input.expectedRevision, "App Map Variable inference expectedRevision");
      string(input.leaseId, "App Map Variable inference leaseId");
      const target = record(input.target, "App Map Variable inference target");
      if (target.kind !== "device" && target.kind !== "browser") {
        fail("App Map Variable inference target kind", "must be device or browser");
      }
      string(target.targetId, "App Map Variable inference targetId");
      const taughtRows = Array.isArray(input.taughtRows)
        ? input.taughtRows
        : fail("App Map Variable inference taughtRows", "must be an array");
      if (taughtRows.length === 0)
        fail("App Map Variable inference taughtRows", "must be non-empty");
      for (const row of taughtRows) {
        const taught = record(row, "App Map Variable inference taught row");
        string(taught.id, "App Map Variable inference taught row id");
      }
    },
  );
  const appMapVariableInferOutputParser = objectParser<
    AppMapOperationOutput<"app-map.variable.infer">
  >("App Map Variable inference response", (output) => {
    string(output.appMapId, "App Map Variable inference response appMapId");
    number(output.expectedRevision, "App Map Variable inference response expectedRevision");
    number(output.capturedAt, "App Map Variable inference response capturedAt");
    record(output.variable, "App Map Variable inference response variable");
    const mutation = record(output.mutation, "App Map Variable inference response mutation");
    if (mutation.operationId !== "app-map.variable.save") {
      fail(
        "App Map Variable inference response mutation operationId",
        "must be app-map.variable.save",
      );
    }
    record(mutation.input, "App Map Variable inference response mutation input");
  });

  const appMapScreenConsolidateParser = objectParser<
    AppMapOperationInput<"app-map.screen.consolidate">
  >("screen consolidation", (input) => {
    string(input.appMapId, "screen consolidation appMapId");
    string(input.targetScreenId, "screen consolidation targetScreenId");
    number(input.expectedRevision, "screen consolidation expectedRevision");
    if (!Array.isArray(input.sourceScreenIds) || input.sourceScreenIds.length === 0) {
      fail("screen consolidation sourceScreenIds", "must be a non-empty array");
    }
    (input.sourceScreenIds as unknown[]).forEach((id, index) =>
      string(id, `screen consolidation sourceScreenIds ${index}`),
    );
    if (input.eventId !== undefined) string(input.eventId, "screen consolidation eventId");
    if (input.dryRun !== undefined) boolean(input.dryRun, "screen consolidation dryRun");
    if (input.targetTitle !== undefined)
      string(input.targetTitle, "screen consolidation targetTitle");
    if (input.mode !== undefined && input.mode !== "scroll-surface" && input.mode !== "same-screen")
      fail("screen consolidation mode", "must be scroll-surface or same-screen");
    if (input.mode === "same-screen" && input.surfaceImport !== undefined)
      fail("screen consolidation surfaceImport", "cannot be used for same-screen merging");
    if (input.surfaceImport !== undefined) {
      const surface = record(input.surfaceImport, "screen consolidation surfaceImport");
      number(surface.schemaVersion, "screen consolidation surfaceImport schemaVersion");
      string(surface.id, "screen consolidation surfaceImport id");
      string(surface.targetProfileId, "screen consolidation surfaceImport targetProfileId");
      string(surface.message, "screen consolidation surfaceImport message");
      boolean(
        surface.restoredStartViewport,
        "screen consolidation surfaceImport restoredStartViewport",
      );
      const policy = record(
        surface.capturePolicy,
        "screen consolidation surfaceImport capturePolicy",
      );
      string(policy.captureMode, "screen consolidation surfaceImport captureMode");
      string(policy.source, "screen consolidation surfaceImport source");
      string(policy.reason, "screen consolidation surfaceImport reason");
      number(policy.decidedAt, "screen consolidation surfaceImport decidedAt");
      if (!Array.isArray(surface.viewports) || surface.viewports.length < 2) {
        fail("screen consolidation surfaceImport viewports", "must contain at least two items");
      }
      const parseEvidence = (value: unknown, label: string) => {
        const evidence = record(value, label);
        string(evidence.id, `${label} id`);
        string(evidence.uri, `${label} uri`);
        string(evidence.sha256, `${label} sha256`);
        string(evidence.mime, `${label} mime`);
        number(evidence.bytes, `${label} bytes`);
      };
      (surface.viewports as unknown[]).forEach((value, index) => {
        const viewport = record(value, `screen consolidation surfaceImport viewport ${index}`);
        for (const field of [
          "index",
          "offsetY",
          "appendedHeight",
          "capturedAt",
          "width",
          "height",
        ] as const)
          number(viewport[field], `screen consolidation surfaceImport viewport ${index} ${field}`);
        parseEvidence(
          viewport.screenshot,
          `screen consolidation surfaceImport viewport ${index} screenshot`,
        );
        parseEvidence(
          viewport.accessibilityTree,
          `screen consolidation surfaceImport viewport ${index} accessibilityTree`,
        );
      });
    }
  });

  const appMapScreenConsolidateOutputParser = objectParser<
    AppMapOperationOutput<"app-map.screen.consolidate">
  >("screen consolidation response", (output) => {
    record(output.appMap, "screen consolidation App Map");
    boolean(output.applied, "screen consolidation applied");
    record(output.preview, "screen consolidation preview");
  });

  const appMapScreenCaptureOutputParser = objectParser<
    AppMapOperationOutput<"app-map.screen.capture">
  >("App Map screen capture response", (output) => {
    string(output.appMapId, "App Map screen capture response appMapId");
    number(output.appMapRevision, "App Map screen capture response revision");
    record(output.screen, "App Map screen capture response screen");
    record(output.variant, "App Map screen capture response variant");
    boolean(output.created, "App Map screen capture response created");
    if (output.reviewProposalId !== undefined)
      string(output.reviewProposalId, "App Map screen capture response reviewProposalId");
  });

  const appMapScrollSurfaceCaptureParser = objectParser<
    AppMapOperationInput<"app-map.scroll-surface.capture">
  >("App Map scroll surface capture", (input) => {
    string(input.appMapId, "App Map scroll surface capture appMapId");
    string(input.screenId, "App Map scroll surface capture screenId");
    string(input.variantId, "App Map scroll surface capture variantId");
    number(input.expectedRevision, "App Map scroll surface capture expectedRevision");
    if (input.eventId !== undefined)
      string(input.eventId, "App Map scroll surface capture eventId");
    string(input.leaseId, "App Map scroll surface capture leaseId");
    const target = record(input.target, "App Map scroll surface capture target");
    if (target.kind !== "device" || (target.platform !== "android" && target.platform !== "ios")) {
      fail("App Map scroll surface capture target", "must be an Android or iOS device");
    }
    string(target.targetId, "App Map scroll surface capture targetId");
    if (
      input.maxScrolls !== undefined &&
      (typeof input.maxScrolls !== "number" ||
        !Number.isInteger(input.maxScrolls) ||
        input.maxScrolls < 1 ||
        input.maxScrolls > 12)
    ) {
      fail("App Map scroll surface capture maxScrolls", "must be an integer between 1 and 12");
    }
  });

  const appMapScrollSurfaceCaptureOutputParser = objectParser<
    AppMapOperationOutput<"app-map.scroll-surface.capture">
  >("App Map scroll surface capture response", (output) => {
    record(output.appMap, "App Map scroll surface capture response appMap");
    record(output.screen, "App Map scroll surface capture response screen");
    record(output.variant, "App Map scroll surface capture response variant");
    record(output.scrollSurface, "App Map scroll surface capture response scrollSurface");
  });

  const appMapScrollSurfaceRegenerateParser = objectParser<
    AppMapOperationInput<"app-map.scroll-surface.regenerate">
  >("App Map scroll surface regeneration", (input) => {
    string(input.appMapId, "App Map scroll surface regeneration appMapId");
    string(input.screenId, "App Map scroll surface regeneration screenId");
    string(input.variantId, "App Map scroll surface regeneration variantId");
    string(input.captureId, "App Map scroll surface regeneration captureId");
    number(input.expectedRevision, "App Map scroll surface regeneration expectedRevision");
    if (input.eventId !== undefined)
      string(input.eventId, "App Map scroll surface regeneration eventId");
  });

  const appMapScrollSurfaceRegenerateOutputParser = objectParser<
    AppMapOperationOutput<"app-map.scroll-surface.regenerate">
  >("App Map scroll surface regeneration response", (output) => {
    record(output.appMap, "App Map scroll surface regeneration response appMap");
    record(output.screen, "App Map scroll surface regeneration response screen");
    record(output.variant, "App Map scroll surface regeneration response variant");
    record(output.scrollSurface, "App Map scroll surface regeneration response scrollSurface");
  });

  const appMapTeachParser = objectParser<AppMapOperationInput<"app-map.teach">>(
    "App Map teach",
    (input) => {
      string(input.appMapId, "App Map teach appMapId");
      if (input.expectedRevision !== undefined) {
        number(input.expectedRevision, "App Map teach expectedRevision");
      }
      if (input.eventId !== undefined) string(input.eventId, "App Map teach eventId");
      string(input.leaseId, "App Map teach leaseId");
      const target = record(input.target, "App Map teach target");
      if (target.kind !== "device" && target.kind !== "browser") {
        fail("App Map teach target kind", "must be device or browser");
      }
      if (
        target.platform !== "android" &&
        target.platform !== "ios" &&
        target.platform !== "browser"
      ) {
        fail("App Map teach target platform", "must be android, ios, or browser");
      }
      string(target.targetId, "App Map teach targetId");
      if (input.fromScreenId !== undefined)
        string(input.fromScreenId, "App Map teach fromScreenId");
      if (input.title !== undefined) string(input.title, "App Map teach title");
      if (input.label !== undefined) string(input.label, "App Map teach label");
      if (input.authenticationFixtureReference !== undefined) {
        string(
          input.authenticationFixtureReference,
          "App Map teach authenticationFixtureReference",
        );
      }
      if (input.handoff !== undefined) {
        const handoff = record(input.handoff, "App Map teach handoff");
        string(handoff.expectedApp, "App Map teach handoff expectedApp");
        if (handoff.returnAction !== "back" && handoff.returnAction !== "relaunch-source") {
          fail("App Map teach handoff returnAction", "must be back or relaunch-source");
        }
      }
      if (input.interaction !== undefined) {
        const interaction = record(input.interaction, "App Map teach interaction");
        const kind = string(interaction.kind, "App Map teach interaction kind");
        if (kind === "point") {
          number(interaction.x, "App Map teach interaction x");
          number(interaction.y, "App Map teach interaction y");
        } else if (kind === "label") {
          string(interaction.label, "App Map teach interaction label");
          if (interaction.point !== undefined) {
            const point = record(interaction.point, "App Map teach interaction point");
            number(point.x, "App Map teach interaction point x");
            number(point.y, "App Map teach interaction point y");
          }
        } else if (kind === "identifier") {
          string(interaction.identifier, "App Map teach interaction identifier");
          if (interaction.point !== undefined) {
            const point = record(interaction.point, "App Map teach interaction point");
            number(point.x, "App Map teach interaction point x");
            number(point.y, "App Map teach interaction point y");
          }
        } else if (kind === "swipe") {
          const from = record(interaction.from, "App Map teach swipe from");
          number(from.x, "App Map teach swipe from x");
          number(from.y, "App Map teach swipe from y");
          const to = record(interaction.to, "App Map teach swipe to");
          number(to.x, "App Map teach swipe to x");
          number(to.y, "App Map teach swipe to y");
          if (interaction.durationMs !== undefined) {
            number(interaction.durationMs, "App Map teach swipe durationMs");
          }
        } else {
          fail("App Map teach interaction kind", "must be point, label, identifier, or swipe");
        }
      }
    },
  );

  const appMapTeachOutputParser = objectParser<AppMapOperationOutput<"app-map.teach">>(
    "App Map teach response",
    (output) => {
      string(output.appMapId, "App Map teach response appMapId");
      number(output.appMapRevision, "App Map teach response revision");
      record(output.screen, "App Map teach response screen");
      record(output.variant, "App Map teach response variant");
      boolean(output.created, "App Map teach response created");
      if (output.reviewProposalId !== undefined)
        string(output.reviewProposalId, "App Map teach response reviewProposalId");
      if (output.connectionId !== undefined)
        string(output.connectionId, "App Map teach connectionId");
    },
  );

  const observationProposalInputParser = objectParser<
    AppMapOperationInput<"app-map.observations.propose">
  >("observation proposal", (input) => {
    string(input.appMapId, "observation proposal appMapId");
    string(input.sessionId, "observation proposal sessionId");
    number(input.expectedRevision, "observation proposal expectedRevision");
    if (input.proposalId !== undefined) string(input.proposalId, "observation proposal proposalId");
    if (input.title !== undefined) string(input.title, "observation proposal title");
    if (
      input.transitionIds !== undefined &&
      (!Array.isArray(input.transitionIds) ||
        input.transitionIds.some((id) => typeof id !== "string" || !id.trim()))
    ) {
      fail("observation proposal transitionIds", "must contain non-empty strings");
    }
    if (input.eventId !== undefined) string(input.eventId, "observation proposal eventId");
  });

  const observationProposalOutputParser = objectParser<
    AppMapOperationOutput<"app-map.observations.propose">
  >("observation proposal response", (input) => {
    record(input.appMap, "observation proposal App Map");
    string(input.proposalId, "observation proposal proposalId");
  });

  const appMapCommitParser = objectParser<AppMapOperationInput<"app-map.commit">>(
    "App Map commit",
    (input) => {
      string(input.appMapId, "App Map commit appMapId");
      number(input.expectedRevision, "App Map commit expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "App Map commit eventId");
      if (input.summary !== undefined) string(input.summary, "App Map commit summary");
      if (!Array.isArray(input.changes)) fail("App Map commit changes", "must be an array");
      if (input.patch !== undefined) record(input.patch, "App Map commit patch");
    },
  );

  const appMapTestCompileInputParser = objectParser<AppMapOperationInput<"app-map.test.compile">>(
    "Test compilation",
    (input) => {
      string(input.appMapId, "Test compilation appMapId");
      string(input.testId, "Test compilation testId");
      if (input.entryCheckpointScreenId !== undefined) {
        string(input.entryCheckpointScreenId, "Test compilation entryCheckpointScreenId");
      }
      if (
        input.startupMode !== undefined &&
        input.startupMode !== "warm" &&
        input.startupMode !== "cold"
      ) {
        fail("Test compilation startupMode", "must be warm or cold");
      }
      if (input.targetProfileId !== undefined) {
        string(input.targetProfileId, "Test compilation targetProfileId");
      }
      if (
        input.forceRecaptureScreenIds !== undefined &&
        (!Array.isArray(input.forceRecaptureScreenIds) ||
          input.forceRecaptureScreenIds.some((id) => typeof id !== "string" || !id.trim()))
      ) {
        fail("Test compilation forceRecaptureScreenIds", "must contain non-empty strings");
      }
    },
  );

  const appMapTestCompileOutputParser = objectParser<AppMapOperationOutput<"app-map.test.compile">>(
    "Test compilation response",
    (output) => {
      record(output.plan, "Test compilation plan");
      record(output.preflight, "Test compilation offline preflight");
      if (output.nativeCompanion !== undefined) {
        record(output.nativeCompanion, "Test compilation native companion");
      }
    },
  );

  const appMapTestFromIntentInputParser = objectParser<
    AppMapOperationInput<"app-map.test.from-intent">
  >("intent walk", (input) => {
    string(input.appMapId, "intent walk appMapId");
    string(input.intent, "intent walk intent");
  });

  const appMapTestFromIntentOutputParser = objectParser<
    AppMapOperationOutput<"app-map.test.from-intent">
  >("intent walk response", (output) => {
    string(output.status, "intent walk status");
    string(output.intent, "intent walk intent");
    if (!Array.isArray(output.matches)) fail("intent walk matches", "must be an array");
  });

  const appMapTestDraftInputParser = objectParser<AppMapOperationInput<"app-map.test.draft">>(
    "test draft",
    (input) => {
      string(input.appMapId, "test draft appMapId");
      string(input.goal, "test draft goal");
      if (input.startUrl !== undefined) string(input.startUrl, "test draft startUrl");
    },
  );

  const appMapTestDraftOutputParser = objectParser<AppMapOperationOutput<"app-map.test.draft">>(
    "test draft response",
    (output) => {
      string(output.name, "test draft name");
      string(output.source, "test draft source");
      if (!Array.isArray(output.steps)) fail("test draft steps", "must be an array");
    },
  );

  return {
    appMapTestDraftInputParser,
    appMapTestDraftOutputParser,
    appMapScreenRefreshPrepareParser,
    appMapScreenRefreshApplyParser,
    appMapScreenRefreshPrepareOutputParser,
    appMapScreenRefreshApplyOutputParser,
    appMapCommitParser,
    appMapCombinePreflightInputParser,
    appMapCombinePreflightOutputParser,
    appMapConnectionCreateParser,
    appMapConnectionRunOutputParser,
    appMapConnectionRunParser,
    appMapCreateParser,
    appMapDuplicateParser,
    appMapExportParser,
    appMapFlowRunOutputParser,
    appMapFlowRunParser,
    appMapFlowSaveParser,
    appMapImportOutputParser,
    appMapImportParser,
    appMapListOutputParser,
    appMapMutationParser,
    appMapProposalApproveParser,
    appMapOutputParser,
    appMapRefParser,
    appMapRoutineSaveParser,
    appMapScreenAddParser,
    appMapScreenCaptureOutputParser,
    appMapScreenCaptureParser,
    appMapScreenAliasObserveParser,
    appMapScreenAliasObserveOutputParser,
    appMapVariableInferParser,
    appMapVariableInferOutputParser,
    appMapScreenConsolidateParser,
    appMapScreenConsolidateOutputParser,
    appMapScrollSurfaceCaptureOutputParser,
    appMapScrollSurfaceCaptureParser,
    appMapScrollSurfaceRegenerateOutputParser,
    appMapScrollSurfaceRegenerateParser,
    ...reviewedOriginParsers,
    appMapTeachOutputParser,
    appMapTeachParser,
    appMapTestCompileInputParser,
    appMapTestCompileOutputParser,
    appMapTestFromIntentInputParser,
    appMapTestFromIntentOutputParser,
    ...testRunParsers,
    observationProposalInputParser,
    observationProposalOutputParser,
  };
}
