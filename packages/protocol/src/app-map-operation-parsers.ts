import type { AppMap } from "./app-map.js";
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
      if (input.serial !== undefined) string(input.serial, "App Map flow run serial");
      if (input.browserTargetId !== undefined) {
        string(input.browserTargetId, "App Map flow run browserTargetId");
      }
      if (
        input.platform !== undefined &&
        input.platform !== "android" &&
        input.platform !== "ios"
      ) {
        fail("App Map flow run platform", "must be android or ios");
      }
      if (
        input.targetKind !== undefined &&
        input.targetKind !== "device" &&
        input.targetKind !== "browser"
      ) {
        fail("App Map flow run targetKind", "must be device or browser");
      }
      if (input.variables !== undefined) {
        for (const [name, value] of Object.entries(record(input.variables, "App Map variables"))) {
          if (Array.isArray(value)) {
            value.forEach((item) => string(item, `App Map variable ${name}`));
          } else {
            string(value, `App Map variable ${name}`);
          }
        }
      }
    },
  );

  const appMapFlowRunOutputParser = objectParser<AppMapOperationOutput<"app-map.flow.run">>(
    "App Map flow run response",
    (input) => {
      record(input.job, "App Map flow run job");
      if (!Array.isArray(input.jobs)) fail("App Map flow run jobs", "must be an array");
      record(input.plan, "App Map flow run plan");
      if (input.matrix !== undefined) record(input.matrix, "App Map flow run matrix");
    },
  );

  const appMapConnectionRunParser = objectParser<AppMapOperationInput<"app-map.connection.run">>(
    "App Map connection run input",
    (input) => {
      string(input.appMapId, "App Map connection run appMapId");
      string(input.connectionId, "App Map connection run connectionId");
      if (input.serial !== undefined) string(input.serial, "App Map connection run serial");
      if (input.browserTargetId !== undefined) {
        string(input.browserTargetId, "App Map connection run browserTargetId");
      }
      if (
        input.platform !== undefined &&
        input.platform !== "android" &&
        input.platform !== "ios"
      ) {
        fail("App Map connection run platform", "must be android or ios");
      }
      if (
        input.targetKind !== undefined &&
        input.targetKind !== "device" &&
        input.targetKind !== "browser"
      ) {
        fail("App Map connection run targetKind", "must be device or browser");
      }
      if (input.variables !== undefined) {
        for (const [name, value] of Object.entries(record(input.variables, "App Map variables"))) {
          if (Array.isArray(value)) {
            value.forEach((item) => string(item, `App Map variable ${name}`));
          } else {
            string(value, `App Map variable ${name}`);
          }
        }
      }
    },
  );

  const appMapConnectionRunOutputParser = objectParser<
    AppMapOperationOutput<"app-map.connection.run">
  >("App Map connection run response", (input) => {
    record(input.job, "App Map connection run job");
    if (!Array.isArray(input.jobs)) fail("App Map connection run jobs", "must be an array");
    record(input.plan, "App Map connection run plan");
    if (input.matrix !== undefined) record(input.matrix, "App Map connection run matrix");
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

  function validateAppMapTestEdits(input: Record<string, unknown>, label: string): void {
    const edits = input.edits;
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > 100) {
      fail(`${label} edits`, "must contain between 1 and 100 semantic edits");
    }
    const semanticEdits = edits as unknown[];
    for (const [index, raw] of semanticEdits.entries()) {
      const edit = record(raw, `${label} edit ${index}`);
      const kind = string(edit.kind, `${label} edit ${index} kind`);
      if (kind === "test.patch") {
        record(edit.patch, `${label} edit ${index} patch`);
      } else if (kind === "step.add") {
        record(edit.step, `${label} edit ${index} step`);
        if (edit.placement !== undefined)
          record(edit.placement, `${label} edit ${index} placement`);
        if (edit.index !== undefined) number(edit.index, `${label} edit ${index} index`);
      } else if (kind === "step.patch") {
        string(edit.stepId, `${label} edit ${index} stepId`);
        record(edit.patch, `${label} edit ${index} patch`);
      } else if (kind === "step.remove") {
        string(edit.stepId, `${label} edit ${index} stepId`);
      } else if (kind === "step.reorder") {
        const orderedStepIds = edit.orderedStepIds;
        if (!Array.isArray(orderedStepIds)) {
          fail(`${label} edit ${index} orderedStepIds`, "must be an array");
        }
        (orderedStepIds as unknown[]).forEach((id, stepIndex) =>
          string(id, `${label} edit ${index} orderedStepIds ${stepIndex}`),
        );
        if (edit.placement !== undefined)
          record(edit.placement, `${label} edit ${index} placement`);
      } else if (kind === "step.bind") {
        string(edit.stepId, `${label} edit ${index} stepId`);
        record(edit.binding, `${label} edit ${index} binding`);
      } else if (kind === "step.unbind") {
        string(edit.stepId, `${label} edit ${index} stepId`);
        string(edit.reason, `${label} edit ${index} reason`);
        if (edit.candidates !== undefined && !Array.isArray(edit.candidates)) {
          fail(`${label} edit ${index} candidates`, "must be an array");
        }
      } else {
        fail(`${label} edit ${index} kind`, "is unsupported");
      }
    }
  }

  const appMapTestEditInputParser = objectParser<AppMapOperationInput<"app-map.test.edit">>(
    "Test edit",
    (input) => {
      string(input.appMapId, "Test edit appMapId");
      string(input.testId, "Test edit testId");
      number(input.expectedRevision, "Test edit expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "Test edit eventId");
      validateAppMapTestEdits(input, "Test");
    },
  );

  const appMapTestProposeInputParser = objectParser<AppMapOperationInput<"app-map.test.propose">>(
    "Test proposal",
    (input) => {
      string(input.appMapId, "Test proposal appMapId");
      string(input.testId, "Test proposal testId");
      number(input.expectedRevision, "Test proposal expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "Test proposal eventId");
      if (input.proposalId !== undefined) string(input.proposalId, "Test proposal proposalId");
      if (input.title !== undefined) string(input.title, "Test proposal title");
      if (input.description !== undefined) string(input.description, "Test proposal description");
      validateAppMapTestEdits(input, "Test proposal");
    },
  );

  const appMapTestRunInputParser = objectParser<AppMapOperationInput<"app-map.test.run">>(
    "Test run",
    (input) => {
      string(input.appMapId, "Test run appMapId");
      string(input.testId, "Test run testId");
      if (number(input.expectedRevision, "Test run expectedRevision") < 0) {
        fail("Test run expectedRevision", "must be non-negative");
      }
      const target = record(input.target, "Test run target");
      string(target.targetId, "Test run targetId");
      if (target.kind !== "device" && target.kind !== "browser") {
        fail("Test run target kind", "must be device or browser");
      }
      if (
        target.platform !== "android" &&
        target.platform !== "ios" &&
        target.platform !== "browser"
      ) {
        fail("Test run target platform", "must be android, ios, or browser");
      }
      if (
        (target.kind === "browser" && target.platform !== "browser") ||
        (target.kind === "device" && target.platform === "browser")
      ) {
        fail("Test run target", "kind and platform do not describe the same target");
      }
    },
  );

  const appMapTestRunOutputParser = objectParser<AppMapOperationOutput<"app-map.test.run">>(
    "Test run response",
    (output) => {
      const identity = record(output.planIdentity, "Test run plan identity");
      string(identity.appMapId, "Test run plan identity appMapId");
      number(identity.appMapRevision, "Test run plan identity appMapRevision");
      string(identity.testId, "Test run plan identity testId");
      string(identity.rootRecipeId, "Test run plan identity rootRecipeId");
      record(output.plan, "Test run plan");
      record(output.job, "Test run job");
    },
  );

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
    },
  );
  const appMapCombinePreflightInputParser = objectParser<
    AppMapOperationInput<"app-map.combine.preflight">
  >("Run matrix preflight", (input) => {
    string(input.appMapId, "Run matrix preflight appMapId");
    string(input.combineId, "Run matrix preflight combineId");
    if (input.serial !== undefined) string(input.serial, "Run matrix preflight serial");
    if (input.selected !== undefined) record(input.selected, "Run matrix preflight selected");
    if (
      input.strategy !== undefined &&
      input.strategy !== "zip" &&
      input.strategy !== "cartesian" &&
      input.strategy !== "pairwise"
    ) {
      fail("Run matrix preflight strategy", "must be zip, cartesian, or pairwise");
    }
  });
  const appMapCombinePreflightOutputParser = objectFieldParser<
    AppMapOperationOutput<"app-map.combine.preflight">
  >("Run matrix preflight response", "preflight");

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
      if (input.position !== undefined) {
        const position = record(input.position, "App Map screen capture position");
        number(position.x, "App Map screen capture position x");
        number(position.y, "App Map screen capture position y");
      }
    },
  );

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
        input.maxScrolls > 6)
    ) {
      fail("App Map scroll surface capture maxScrolls", "must be an integer between 1 and 6");
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

  const appMapTestProposeOutputParser = objectParser<AppMapOperationOutput<"app-map.test.propose">>(
    "Test proposal response",
    (output) => {
      record(output.appMap, "Test proposal App Map");
      string(output.proposalId, "Test proposal proposalId");
    },
  );

  const appMapTestCompileInputParser = objectParser<AppMapOperationInput<"app-map.test.compile">>(
    "Test compilation",
    (input) => {
      string(input.appMapId, "Test compilation appMapId");
      string(input.testId, "Test compilation testId");
    },
  );

  const appMapTestCompileOutputParser = objectParser<AppMapOperationOutput<"app-map.test.compile">>(
    "Test compilation response",
    (output) => record(output.plan, "Test compilation plan"),
  );

  return {
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
    appMapOutputParser,
    appMapRefParser,
    appMapRoutineSaveParser,
    appMapScreenAddParser,
    appMapScreenCaptureOutputParser,
    appMapScreenCaptureParser,
    appMapScreenConsolidateParser,
    appMapScreenConsolidateOutputParser,
    appMapScrollSurfaceCaptureOutputParser,
    appMapScrollSurfaceCaptureParser,
    appMapScrollSurfaceRegenerateOutputParser,
    appMapScrollSurfaceRegenerateParser,
    appMapTeachOutputParser,
    appMapTeachParser,
    appMapTestCompileInputParser,
    appMapTestCompileOutputParser,
    appMapTestEditInputParser,
    appMapTestProposeInputParser,
    appMapTestProposeOutputParser,
    appMapTestRunInputParser,
    appMapTestRunOutputParser,
    observationProposalInputParser,
    observationProposalOutputParser,
  };
}
