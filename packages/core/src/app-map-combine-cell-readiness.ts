import type {
  AppMap,
  AppMapCombine,
  AppMapCombineCellState,
  AppMapCombinePreflightIssue,
  AppMapCompiledRuntimeTargetProfile,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  CombineProfileTargetInput,
  OfflineTestPreflightFinding,
  OfflineTestPreflightReport,
} from "@relay/protocol";
import {
  AppMapTargetProfileError,
  resolveAppMapTestForTargetProfile,
} from "./app-map-native-companion-compile.js";
import { AppMapTestCompileError } from "./app-map-test-compile-error.js";
import type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";
import {
  AppMapCombineCellContractError,
  resolveSavedAppMapRuntimeTargetProfile,
  savedAppMapTargetProfileIdsForTarget,
} from "./app-map-combine-cell-prepare.js";
import { localExecutionTargetRef } from "./app-map-combine-cell-target-binding.js";
import { resolveCombineCellCompanion } from "./app-map-native-companion-combine.js";
import { assertRecordedCompanionForRun } from "./app-map-native-companion-run.js";
import { inheritSavedRuntimeProfileId } from "./browser-case-profile-target.js";
import { compileOptionsForVisualSurface } from "./combine-visual-surface.js";
import { loadFrozenRawAccessibilityEvidence } from "./frozen-raw-accessibility.js";
import { compileAppMapTest } from "./map-work.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import { targetDescription } from "./offline-test-preflight-selector-utils.js";

type Target = { targetId: string; platform: string };

export function selectedCombinePreflightCells(
  cells: readonly { cellId: string }[],
  requested?: readonly string[],
): { ids: Set<string>; issues: AppMapCombinePreflightIssue[] } {
  const known = new Set(cells.map((cell) => cell.cellId));
  const ids = new Set(requested?.length ? requested : known);
  return {
    ids,
    issues: [...ids]
      .filter((id) => !known.has(id))
      .map((cellId) => ({
        code: "foreign-binding",
        message: "A selected case is not in this Plan. Refresh the Plan selection.",
        cellId,
      })),
  };
}

function columnTarget(column: CombineProfileTargetInput): Target | undefined {
  const browserTargetId = column.target.browserTargetId?.trim();
  const serial = column.target.serial?.trim();
  if (Boolean(browserTargetId) === Boolean(serial)) return undefined;
  const platform = column.target.platform ?? (browserTargetId ? "browser" : undefined);
  if (
    !platform ||
    (browserTargetId && platform !== "browser") ||
    (serial && platform === "browser")
  ) {
    return undefined;
  }
  if (
    column.target.targetKind &&
    column.target.targetKind !== (browserTargetId ? "browser" : "device")
  ) {
    return undefined;
  }
  return { targetId: browserTargetId ?? serial!, platform };
}

export function firstCombinePreflightColumn(
  columns: readonly CombineProfileTargetInput[] | undefined,
): { target?: Target; targetProfileId?: string } {
  const column = columns?.[0];
  const target = column ? columnTarget(column) : undefined;
  return column
    ? {
        ...(target ? { target } : {}),
        ...(column.targetProfileId?.trim()
          ? { targetProfileId: column.targetProfileId.trim() }
          : {}),
      }
    : {};
}

function stepIntent(steps: readonly AppMapScenarioTestStep[], id?: string): string | undefined {
  for (const step of steps) {
    if (step.id === id) return step.intent;
    const found =
      step.kind === "loop"
        ? stepIntent(step.steps, id)
        : step.kind === "decision"
          ? stepIntent([...step.thenSteps, ...(step.elseSteps ?? [])], id)
          : undefined;
    if (found) return found;
  }
  return undefined;
}

type CheckedTest = {
  test: AppMapScenarioTest;
  compiled: ReturnType<typeof compileAppMapTest>;
  report: OfflineTestPreflightReport;
};

function findingMessage(
  report: OfflineTestPreflightReport,
  finding: OfflineTestPreflightFinding,
): string {
  const selector = report.selectors.find(
    (entry) => entry.recipeId === finding.recipeId && entry.recipeStepId === finding.recipeStepId,
  );
  const target = selector ? targetDescription(selector.target) : "Saved screen evidence";
  switch (finding.code) {
    case "raw-evidence-variant-selection-required":
      return `${target} needs an exact saved setup before its captured evidence can be checked.`;
    case "raw-evidence-variant-recapture-required":
      return `${target} is not proven by the selected setup's captured evidence. Recapture this step or choose a proven selector.`;
    case "raw-evidence-recapture-required":
      return `${target} has missing, corrupt, or unbound saved accessibility evidence. Recapture this step.`;
    default:
      return finding.message;
  }
}

async function resolveCellTest(input: {
  map: AppMap;
  test: AppMapScenarioTest;
  requestedProfile: string;
  target?: Target;
  readAppMap?: (appMapId: string) => Promise<AppMap | null>;
}): Promise<{
  map: AppMap;
  test: AppMapScenarioTest;
  runtimeTargetProfile?: AppMapCompiledRuntimeTargetProfile;
}> {
  const platform = input.target?.platform;
  if (
    input.target &&
    (!input.target.targetId.trim() ||
      (platform !== "ios" && platform !== "android" && platform !== "browser"))
  ) {
    throw new AppMapCombineCellContractError("The selected target is unsupported.", [], []);
  }
  if (input.target && (platform === "ios" || platform === "android" || platform === "browser")) {
    const target: { targetId: string; platform: "ios" | "android" | "browser" } = {
      targetId: input.target.targetId,
      platform,
    };
    const companion = await resolveCombineCellCompanion({
      map: input.map,
      test: input.test,
      requestedProfileId: input.requestedProfile,
      requestedTarget: localExecutionTargetRef(target),
      readAppMap: input.readAppMap,
    });
    if (companion) return companion;
    return {
      map: input.map,
      test: input.test,
      runtimeTargetProfile: resolveSavedAppMapRuntimeTargetProfile({
        map: input.map,
        targetProfileId: input.requestedProfile,
        target,
      }),
    };
  }
  const resolved = await resolveAppMapTestForTargetProfile({
    map: input.map,
    test: input.test,
    targetProfileId: input.requestedProfile,
    readAppMap: input.readAppMap ?? (async () => null),
  });
  assertRecordedCompanionForRun({
    testId: input.test.id,
    targetProfileId: input.requestedProfile,
    nativeCompanion: resolved.nativeCompanion,
  });
  const profile = resolved.runtimeTargetProfile;
  return resolved.nativeCompanion || !profile
    ? resolved
    : {
        ...resolved,
        runtimeTargetProfile: resolveSavedAppMapRuntimeTargetProfile({
          map: input.map,
          targetProfileId: input.requestedProfile,
          target: { targetId: profile.targetId, platform: profile.platform },
        }),
      };
}

/** Read only saved profile identities and immutable evidence. A bound case is
 * not runnable until its exact compiled Test passes the offline proof gate.
 * This deliberately creates no wrapper, execution intent, or frozen inputs. */
export async function assessAppMapCombineCellReadiness(input: {
  map: AppMap;
  combine: AppMapCombine;
  cells: readonly AppMapCombineCellState[];
  selectedCellIds?: readonly string[];
  target?: Target;
  profileTargets?: readonly CombineProfileTargetInput[];
  compileOptions?: AppMapTestCompileOptions;
  readAppMap?: (appMapId: string) => Promise<AppMap | null>;
}): Promise<{
  cells: AppMapCombineCellState[];
  blockers: AppMapCombinePreflightIssue[];
  warnings: AppMapCombinePreflightIssue[];
}> {
  const selection = selectedCombinePreflightCells(input.cells, input.selectedCellIds);
  const blockers = [...selection.issues];
  const warnings: AppMapCombinePreflightIssue[] = [];
  const seen = new Set<string>();
  const checks = new Map<string, Promise<CheckedTest>>();
  const columns = input.profileTargets?.length ? input.profileTargets : [undefined];
  const append = (
    severity: "blocker" | "warning",
    issue: AppMapCombinePreflightIssue,
    detail = "",
  ) => {
    const key = JSON.stringify([
      severity,
      issue.cellId,
      issue.targetProfileId,
      issue.code,
      detail,
      issue.message,
    ]);
    if (seen.has(key)) return;
    seen.add(key);
    (severity === "blocker" ? blockers : warnings).push(issue);
  };
  const cells: AppMapCombineCellState[] = [];
  for (const cell of input.cells) {
    const selected = selection.ids.has(cell.cellId);
    let blocked = cell.binding !== "bound";
    let checked = false;
    for (const column of columns) {
      const target = column ? columnTarget(column) : input.target;
      const requestedProfile = column
        ? column.targetProfileId?.trim() ||
          (target
            ? inheritSavedRuntimeProfileId({
                savedIds: savedAppMapTargetProfileIdsForTarget(input.map, target),
                ...target,
              })
            : undefined)
        : cell.targetProfileId;
      const attribution = {
        cellId: cell.cellId,
        testId: cell.testId,
        values: { ...cell.values },
        ...(requestedProfile ? { targetProfileId: requestedProfile } : {}),
      };
      if ((column && !target) || !requestedProfile) {
        blocked = true;
        append("blocker", {
          code: column && !target ? "mismatched-target-binding" : "missing-binding",
          message: `${cell.testName} · ${cell.worldLabel}: choose an exact saved setup for this case.`,
          ...attribution,
        });
        continue;
      }
      const test = input.map.tests[cell.testId];
      if (!test) continue; // Existing structural preflight owns missing Tests.
      try {
        // Resolve before caching: the same profile must bind to every requested
        // target, and a conflicting saved identity must never borrow a receipt.
        const resolved = await resolveCellTest({
          map: input.map,
          test,
          requestedProfile,
          target,
          readAppMap: input.readAppMap,
        });
        const profile = resolved.runtimeTargetProfile;
        if (!profile) {
          blocked = true;
          append("blocker", {
            code: "mismatched-binding",
            message: `${cell.testName} · ${cell.worldLabel}: the saved setup does not match the selected device or browser.`,
            ...attribution,
          });
          continue;
        }
        // Execution resolves every prepared case's saved identity before
        // applying a pilot selection. Retain that metadata fence, without
        // compiling or loading selector evidence for unrequested cases.
        if (!selected) continue;
        const sameMap = resolved.map.id === input.map.id;
        const effectiveTest = {
          ...resolved.test,
          ...(sameMap && input.combine.captures?.[cell.testId]
            ? { capture: input.combine.captures[cell.testId] }
            : {}),
        };
        const key = JSON.stringify([
          resolved.map.id,
          resolved.map.revision,
          effectiveTest.id,
          profile,
          effectiveTest.capture,
        ]);
        let pending = checks.get(key);
        if (!pending) {
          pending = (async () => {
            const compiled = compileAppMapTest(
              resolved.map,
              effectiveTest,
              compileOptionsForVisualSurface(effectiveTest, {
                ...(sameMap
                  ? input.compileOptions
                  : input.compileOptions?.startupMode
                    ? { startupMode: input.compileOptions.startupMode }
                    : {}),
                runtimeTargetProfile: profile,
              }),
            );
            return {
              test: effectiveTest,
              compiled,
              report: preflightCompiledAppMapTestOffline(
                compiled.plan,
                await loadFrozenRawAccessibilityEvidence(compiled.plan),
                { targetProfileId: profile.id },
              ),
            };
          })();
          checks.set(key, pending);
        }
        const result = await pending;
        checked = true;
        for (const finding of result.report.findings) {
          const provenance = result.compiled.plan.stepProvenance.find(
            (step) =>
              step.recipeId === finding.recipeId && step.recipeStepId === finding.recipeStepId,
          );
          const intent = stepIntent(result.test.steps, provenance?.testStepId);
          if (finding.severity === "blocker") blocked = true;
          append(
            finding.severity,
            {
              code: "invalid-test",
              message: `${cell.testName} · ${cell.worldLabel}${intent ? ` · ${intent}` : ""}: ${findingMessage(result.report, finding)}`,
              ...attribution,
              targetProfileId: profile.id,
            },
            `${finding.code}:${finding.recipeId}:${finding.recipeStepId ?? ""}`,
          );
        }
      } catch (error) {
        blocked = true;
        const profileError =
          error instanceof AppMapTargetProfileError ||
          error instanceof AppMapCombineCellContractError;
        const intent =
          error instanceof AppMapTestCompileError
            ? stepIntent(test.steps, error.stepId)
            : undefined;
        const message = profileError
          ? "The saved setup is missing, conflicting, or does not match the selected device or browser. Choose a current saved setup."
          : error instanceof AppMapTestCompileError
            ? error.code === "target-profile-ambiguous"
              ? "The saved setup has conflicting captured facts. Choose a current saved setup."
              : error.message
            : "Relay could not check this case's saved Test evidence.";
        append("blocker", {
          code: profileError ? "mismatched-binding" : "compile-failed",
          message: `${cell.testName} · ${cell.worldLabel}${intent ? ` · ${intent}` : ""}: ${message}`,
          ...attribution,
        });
      }
    }
    cells.push({
      ...cell,
      ...(blocked
        ? { preflight: "blocked" as const, message: "Saved Test evidence needs attention" }
        : checked
          ? { preflight: "ready" as const }
          : {}),
    });
  }
  return { cells, blockers, warnings };
}
