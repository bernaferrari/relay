import {
  analyzeLocaleRunBatch,
  currentOperationContext,
  exportLocaleRunPackFromBatchId,
  inferLocaleOptionsFromTeach,
  listDeviceLeases,
  listDevices,
  listTargetWorkers,
  localeRunScopeFromTeach,
  prepareLocaleRecipeRun,
  readAppMap,
  recordedLocalePreludeFromMap,
  releaseDeviceLease,
  resolveJobDevicePlatform,
  stagePreparedLocaleRecipeRun,
  startLocaleRecipeRun,
  summarizeJob,
  type LocaleRunCaseTargetBinding,
  type LocaleRunScope,
} from "@relay/core";
import { assertExecutionTargetRef, type LocalCampaignAdmissionRequest } from "@relay/protocol";
import { admitTargetControl, assertTargetControl } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { JobRouteContext } from "./job-routes.js";
import {
  admitAndStageLocalCampaign,
  type LocalCampaignAdmission,
  type LocalCampaignAdmissionWorkItem,
} from "./local-combine-campaign-admission.js";
import {
  materializeLocaleMatrixExecution,
  type LocaleMatrixRouteInput,
} from "./locale-matrix-materialization.js";

type LocaleMatrixCaseTargetBindingInput = {
  caseIndex?: unknown;
  locale?: unknown;
  executionTarget?: unknown;
};

type LocaleMatrixStartBody = LocaleMatrixRouteInput & {
  serial?: string;
  platform?: "android" | "ios";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  /** Explicit, frozen local target for every generated locale case. */
  caseTargetBindings?: LocaleMatrixCaseTargetBindingInput[];
  /** Required with explicit bindings; each cohort must be fresh and exact. */
  localAdmission?: LocalCampaignAdmissionRequest;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validate the transport shape before target admission. The core staging
 * boundary repeats this validation defensively before it makes jobs durable. */
function explicitLocaleTargetBindings(input: {
  bindings: unknown;
  prepared: Awaited<ReturnType<typeof prepareLocaleRecipeRun>>;
  targetPlatform?: "android" | "ios";
}): LocaleRunCaseTargetBinding[] {
  if (!Array.isArray(input.bindings)) {
    throw new HttpError(400, "caseTargetBindings must be an array", {
      code: "LOCAL_LOCALE_ADMISSION_BINDINGS_INVALID",
    });
  }
  if (input.bindings.length !== input.prepared.cases.length) {
    throw new HttpError(
      409,
      `Locale target bindings must cover every case (${input.prepared.cases.length} required).`,
      {
        code: "LOCAL_LOCALE_ADMISSION_BINDINGS_INCOMPLETE",
        recovery:
          "Bind every generated locale case to one explicit local Android or iOS target before requesting deadline admission.",
      },
    );
  }
  const expectedCases = new Map(input.prepared.cases.map((item) => [item.caseIndex, item]));
  const result: LocaleRunCaseTargetBinding[] = [];
  const seen = new Set<number>();
  for (const raw of input.bindings) {
    if (!isRecord(raw)) {
      throw new HttpError(400, "Each locale target binding must be an object", {
        code: "LOCAL_LOCALE_ADMISSION_BINDINGS_INVALID",
      });
    }
    const binding = raw as LocaleMatrixCaseTargetBindingInput;
    const caseIndex = binding.caseIndex;
    if (typeof caseIndex !== "number" || !Number.isSafeInteger(caseIndex) || caseIndex < 0) {
      throw new HttpError(400, "Locale target binding caseIndex must be a non-negative integer", {
        code: "LOCAL_LOCALE_ADMISSION_BINDINGS_INVALID",
      });
    }
    const item = expectedCases.get(caseIndex);
    if (!item || seen.has(caseIndex)) {
      throw new HttpError(409, `Locale target binding case ${caseIndex} is invalid or duplicated`, {
        code: "LOCAL_LOCALE_ADMISSION_BINDINGS_INVALID",
      });
    }
    if (typeof binding.locale !== "string" || binding.locale.trim() !== item.locale) {
      throw new HttpError(
        409,
        `Locale target binding case ${caseIndex} must name ${JSON.stringify(item.locale)}.`,
        { code: "LOCAL_LOCALE_ADMISSION_BINDINGS_INVALID" },
      );
    }
    try {
      assertExecutionTargetRef(binding.executionTarget);
    } catch {
      throw new HttpError(400, "Locale target binding has an invalid executionTarget", {
        code: "LOCAL_LOCALE_ADMISSION_BINDINGS_INVALID",
      });
    }
    if (binding.executionTarget.kind !== "local-device") {
      throw new HttpError(
        409,
        "Locale deadline admission supports local Android and iOS targets only.",
        {
          code: "LOCAL_COMBINE_ADMISSION_TARGET_UNSUPPORTED",
          target: binding.executionTarget,
          recovery:
            "Bind each locale case to a coherent local Android or iOS target. Relay will not treat a browser or unconfigured provider session as local capacity.",
        },
      );
    }
    if (
      input.targetPlatform !== undefined &&
      binding.executionTarget.platform !== input.targetPlatform
    ) {
      throw new HttpError(
        409,
        `Locale profile requires an ${input.targetPlatform} target, but case ${caseIndex + 1} is bound to ${binding.executionTarget.platform}.`,
        {
          code: "LOCALE_PROFILE_TARGET_PLATFORM_MISMATCH",
          requiredPlatform: input.targetPlatform,
          target: binding.executionTarget,
          recovery: `Rebind every locale case to a local ${input.targetPlatform} target for this taught profile.`,
        },
      );
    }
    seen.add(caseIndex);
    result.push({
      caseIndex,
      locale: item.locale,
      executionTarget: structuredClone(binding.executionTarget),
    });
  }
  return result;
}

/**
 * Routes for the locale-matrix workflow. Keeping them together makes
 * its teach, run, export, and analysis contract easier to evolve without
 * obscuring ordinary job lifecycle routes.
 */
export async function handleLocaleMatrixRoute(context: JobRouteContext): Promise<boolean> {
  const { method, pathname, request: req, response: res, scope } = context;
  const runtime = {
    listDevices: context.runtime?.listDevices ?? listDevices,
    listDeviceLeases: context.runtime?.listDeviceLeases ?? listDeviceLeases,
    listTargetWorkers: context.runtime?.listTargetWorkers ?? listTargetWorkers,
    assertTargetControl: context.runtime?.assertTargetControl ?? assertTargetControl,
    admitTargetControl: context.runtime?.admitTargetControl ?? admitTargetControl,
    releaseDeviceLease: context.runtime?.releaseDeviceLease ?? releaseDeviceLease,
    ...(context.runtime?.verifyCampaignDurationCohortEvidence
      ? {
          verifyCampaignDurationCohortEvidence:
            context.runtime.verifyCampaignDurationCohortEvidence,
        }
      : {}),
  };

  if (method === "POST" && pathname === "/jobs/locale-matrix/materialize") {
    const body = (await parseJsonBody(req)) as LocaleMatrixRouteInput;
    try {
      const materialized = await materializeLocaleMatrixExecution({ scope, body });
      json(res, 200, materialized.materialization);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (method === "POST" && pathname === "/jobs/locale-matrix/infer") {
    const body = (await parseJsonBody(req)) as {
      nodes?: unknown;
      examples?: Array<{ locale?: string; identifier?: string; label?: string; text?: string }>;
      locales?: string[];
      app?: string;
      appMapId?: string;
      flowId?: string;
      bodyFlowId?: string;
      selectedConnectionId?: string;
      liveScreenId?: string;
      entryPath?: LocaleRunScope["entryPath"];
      languagePath?: LocaleRunScope["languagePath"];
      screenshotEachLocale?: boolean;
      restoreLocale?: string;
    };
    if (!Array.isArray(body.nodes)) throw new HttpError(400, "nodes must be an accessibility tree");
    if (!Array.isArray(body.examples) || body.examples.length === 0) {
      throw new HttpError(400, "teach at least one locale example");
    }
    const examples = body.examples
      .map((example) => ({
        locale: typeof example.locale === "string" ? example.locale : "",
        ...(typeof example.identifier === "string" ? { identifier: example.identifier } : {}),
        ...(typeof example.label === "string" ? { label: example.label } : {}),
        ...(typeof example.text === "string" ? { text: example.text } : {}),
      }))
      .filter((example) => example.locale.trim());
    if (!examples.length) throw new HttpError(400, "teach at least one locale example");
    let entryPath = body.entryPath;
    let languagePath = body.languagePath;
    if (!entryPath?.length && !languagePath?.length && body.appMapId?.trim()) {
      const map = await readAppMap(scope.projectId, body.appMapId.trim());
      if (map) {
        const prelude = recordedLocalePreludeFromMap(map, {
          bodyFlowId: body.bodyFlowId?.trim() || body.flowId?.trim(),
          selectedConnectionId: body.selectedConnectionId,
          liveScreenId: body.liveScreenId,
        });
        if (prelude) {
          entryPath = prelude.entryPath;
          languagePath = prelude.languagePath;
        }
      }
    }
    const inferred = inferLocaleOptionsFromTeach({
      nodes: body.nodes as never,
      examples,
    });
    const taughtScope = localeRunScopeFromTeach({
      nodes: body.nodes as never,
      examples,
      locales: body.locales,
      app: body.app,
      entryPath,
      languagePath,
      screenshotEachLocale: body.screenshotEachLocale,
      restoreLocale: body.restoreLocale,
    });
    json(res, 200, { inferred, scope: taughtScope });
    return true;
  }

  if (method === "POST" && pathname === "/jobs/locale-matrix") {
    const body = (await parseJsonBody(req)) as LocaleMatrixStartBody;
    const appMapSource = Boolean(
      body.appMapId?.trim() &&
      (body.flowId?.trim() || (body.testId?.trim() && body.variableId?.trim())),
    );
    if (appMapSource) {
      if (
        !Number.isSafeInteger(body.expectedAppMapRevision) ||
        (body.expectedAppMapRevision as number) < 0
      ) {
        throw new HttpError(409, "Start an App Map locale matrix from a fresh materialized plan.", {
          code: "LOCALE_APP_MAP_MATERIALIZATION_REQUIRED",
          recovery:
            "Refresh the Locale Matrix plan so Relay can freeze the current App Map revision before admission.",
        });
      }
    }
    const hasExplicitCaseTargets = body.caseTargetBindings !== undefined;
    if (hasExplicitCaseTargets && !body.localAdmission) {
      throw new HttpError(
        409,
        "Per-case locale target bindings require a local deadline admission request.",
        {
          code: "LOCAL_LOCALE_ADMISSION_REQUIRED",
          recovery:
            "Provide localAdmission with fresh, exact target/Test/action duration evidence and a deadline. Relay will not queue multi-target locale work on assumed capacity.",
        },
      );
    }
    if (!hasExplicitCaseTargets && body.localAdmission) {
      throw new HttpError(409, "localAdmission requires explicit caseTargetBindings.", {
        code: "LOCAL_LOCALE_ADMISSION_BINDINGS_REQUIRED",
        recovery:
          "Bind every generated locale case explicitly so Relay can prove target-affine deadline capacity.",
      });
    }
    try {
      const materialized = await materializeLocaleMatrixExecution({ scope, body });
      const { recipeId, compiledBody, compiledGraph, runScope, durationCohort, targetPlatform } =
        materialized;
      const browserTargetId = body.browserTargetId?.trim();
      const targetId = browserTargetId || body.serial?.trim();
      let platform: "android" | "ios" | undefined;
      if (!hasExplicitCaseTargets) {
        if (!targetId) throw new HttpError(400, "serial or browserTargetId is required");
        if (body.targetKind === "browser" && !browserTargetId) {
          throw new HttpError(400, "A browser locale target requires browserTargetId.");
        }
        if (browserTargetId) {
          // A browser cannot stand in for an iOS- or Android-bound locale
          // contract. In particular, never let a caller attach `platform:ios`
          // to a browser id to make the target look compatible.
          if (targetPlatform) {
            throw new HttpError(
              409,
              `Locale profile requires a local ${targetPlatform} target, but ${targetId} is a browser target.`,
              {
                code: "LOCALE_PROFILE_TARGET_PLATFORM_MISMATCH",
                requiredPlatform: targetPlatform,
                recovery: `Select a local ${targetPlatform} target for this taught profile.`,
              },
            );
          }
        } else {
          // Platform is an observed property of a serial, never caller
          // authority. Resolve it without the optional explicit hint so a
          // request cannot relabel Android as iOS (or vice versa).
          platform = await resolveJobDevicePlatform(targetId);
          if (!platform) {
            throw new HttpError(
              400,
              `Cannot determine whether ${targetId} is iOS or Android. Connect the device and try again.`,
            );
          }
          if (body.platform && body.platform !== platform) {
            throw new HttpError(409, `Target ${targetId} is ${platform}, not ${body.platform}.`, {
              code: "LOCALE_TARGET_PLATFORM_MISMATCH",
              actualPlatform: platform,
              recovery:
                "Refresh the selected device; Relay derives its platform from the connected target.",
            });
          }
        }
        if (targetPlatform && platform !== targetPlatform) {
          throw new HttpError(
            409,
            `Locale profile requires an ${targetPlatform} target, but ${targetId} is ${platform ?? "not a local mobile target"}.`,
            {
              code: "LOCALE_PROFILE_TARGET_PLATFORM_MISMATCH",
              requiredPlatform: targetPlatform,
              recovery: `Select a local ${targetPlatform} target for this taught profile.`,
            },
          );
        }
        await runtime.assertTargetControl(scope, targetId);
      }
      let batch;
      let admission: LocalCampaignAdmission | undefined;
      let acceptedAdmission: LocalCampaignAdmission | undefined;
      let staged: ReturnType<typeof stagePreparedLocaleRecipeRun> | undefined;
      if (hasExplicitCaseTargets) {
        const prepared = await prepareLocaleRecipeRun({
          recipeId,
          ...(compiledBody ? { compiledBody, compiledGraph } : {}),
          scope: runScope,
          title: body.title,
          seed: body.seed,
          projectId: scope.projectId,
          ownerId: currentOperationContext()!.actorId,
          durationCohort,
        });
        const targetBindings = explicitLocaleTargetBindings({
          bindings: body.caseTargetBindings,
          prepared,
          ...(targetPlatform ? { targetPlatform } : {}),
        });
        const workItems: LocalCampaignAdmissionWorkItem[] = targetBindings.map((binding) => ({
          id: `locale:${binding.caseIndex}`,
          target: binding.executionTarget,
          // The wrapper carries a new batch id; only the frozen stable cohort
          // can match the completed-run evidence on a later locale execution.
          testId: prepared.durationCohort.testId,
          action: prepared.durationCohort.action,
        }));
        const workItemByCaseIndex = new Map(
          targetBindings.map((binding, index) => [binding.caseIndex, workItems[index]!]),
        );
        try {
          const admitted = await admitAndStageLocalCampaign({
            scope,
            workItems,
            request: body.localAdmission!,
            runtime,
            stage: (acceptedAdmission) =>
              stagePreparedLocaleRecipeRun({
                prepared,
                targetBindings,
                operationContextForCase: (binding) => {
                  const workItem = workItemByCaseIndex.get(binding.caseIndex);
                  if (!workItem) {
                    throw new Error(`Accepted locale case ${binding.caseIndex} has no work item`);
                  }
                  return acceptedAdmission.operationContextForWorkItem(workItem);
                },
              }),
          });
          admission = admitted.admission;
          acceptedAdmission = admission;
          staged = admitted.staged;
          // All fallible work happens before this final scheduler transfer.
          // If activation or lease persistence fails, the catch below removes
          // every pre-dispatch job and only leases minted by this request.
          staged.activate();
          await admission.commit();
          await admission.finalize();
          const jobs = staged.dispatch();
          batch = {
            id: staged.id,
            recipeId: staged.recipeId,
            bodyRecipeId: staged.bodyRecipeId,
            title: staged.title,
            createdAt: staged.createdAt,
            locales: staged.locales,
            matrix: staged.matrix,
            jobs,
            composedRecipeId: staged.composedRecipeId,
          };
          staged = undefined;
          admission = undefined;
        } catch (error) {
          const cleanupErrors: string[] = [];
          try {
            staged?.rollback();
          } catch (cleanupError) {
            cleanupErrors.push(
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            );
          }
          try {
            await admission?.rollback();
          } catch (cleanupError) {
            cleanupErrors.push(
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            );
          }
          if (cleanupErrors.length) {
            throw new Error(
              `Locale matrix admission failed (${error instanceof Error ? error.message : String(error)}) and compensation also failed: ${cleanupErrors.join("; ")}`,
            );
          }
          throw error;
        }
      } else {
        batch = await startLocaleRecipeRun({
          recipeId,
          ...(compiledBody ? { compiledBody, compiledGraph } : {}),
          targetId: targetId!,
          platform,
          // The target reference determines its kind. Never trust a caller's
          // `targetKind` label to turn a device serial into a browser target.
          targetKind: browserTargetId ? "browser" : "device",
          browserTargetId,
          scope: runScope,
          title: body.title,
          seed: body.seed,
          projectId: scope.projectId,
          ownerId: currentOperationContext()!.actorId,
          durationCohort,
        });
      }
      json(res, 202, {
        batch: {
          id: batch.id,
          recipeId: batch.bodyRecipeId,
          composedRecipeId: batch.composedRecipeId,
          title: batch.title,
          locales: batch.locales,
          createdAt: batch.createdAt,
        },
        matrix: batch.matrix,
        jobs: batch.jobs.map((job) => summarizeJob(job)),
        ...(hasExplicitCaseTargets && acceptedAdmission
          ? {
              admission: {
                preflight: acceptedAdmission.preflight,
                targetPreflights: acceptedAdmission.targetPreflights,
              },
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const localeExportMatch = matchPath(pathname, "/jobs/locale-matrix/:batchId/export");
  if (method === "GET" && localeExportMatch) {
    try {
      const exported = await exportLocaleRunPackFromBatchId(localeExportMatch.batchId!);
      json(res, 200, {
        rootDir: exported.rootDir,
        manifest: exported.manifest,
        jobIds: exported.jobs.map((job) => job.id),
      });
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const localeAnalysisMatch = matchPath(pathname, "/jobs/locale-matrix/:batchId/analysis");
  if (method === "GET" && localeAnalysisMatch) {
    try {
      json(res, 200, await analyzeLocaleRunBatch(localeAnalysisMatch.batchId!));
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  return false;
}
