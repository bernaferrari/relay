/** Recipe execution glue; cancellation always escapes strategy fallbacks. */
import type { Device } from "./device.js";
import {
  DEFAULT_EXPECT_TIMEOUT_MS,
  MAX_WAIT_MS,
  clipboardExpectationError,
  conditionalTargetPresent,
  isCancel,
  isNotFoundOrTimeout,
  readInput,
  resolvePointForDevice,
  runVariableScript,
  targetPresent,
} from "./recipe-runner-support.js";
import { waitForResponseCompletion } from "./recipe-response-completion.js";
import {
  describeCoverageStepReason,
  inspectSetupSkip,
  leftoverSkipForbidden,
} from "./coverage-step-outcome.js";
import {
  campaignExecutionStep,
  invalidateVerifiedScreen,
  stepBreaksVerifiedScreen,
  type RecipeStepContext,
} from "./recipe-runner-context.js";
import {
  boundCoverageExpectScreen,
  rejectForbiddenCoverageEffect,
} from "./campaign-recovery-effects.js";
import { contentAssertionPassed } from "./content-assertion-match.js";
import {
  conversationProvenanceFromArtifacts,
  extractCurrentActionAssistantTurn,
  extractJoinedTargetText,
} from "./recipe-extract.js";
export { isRightToLeftRun, resolveRecipeStep } from "./recipe-runner-support.js";
export type { RecipeStepContext } from "./recipe-runner-context.js";
export { DEFAULT_HUMAN_CHECKPOINT_TIMEOUT_MS } from "./recipe-runner-readiness.js";
import {
  awaitAndroidSemanticReadiness,
  boundedHumanCheckpointTimeoutMs,
  isAndroidSemanticReadinessTarget,
  pollUntil,
} from "./recipe-runner-readiness.js";
import {
  pressKey,
  sleep,
  swipeGesture,
  base,
  clipboardWrite,
  clipboardRead,
  clipboardPaste,
  clipboardCopy,
  changeAndroidAppBuild,
  closeApp,
  inspectAndroidApp,
  setAndroidAppLocale,
  openUrl,
  openAppSwitcher,
  rotateDevice,
  keyboardAction,
  alertAction,
  updateSetting,
  captureNetwork,
  manageLogs,
  setAndroidLockState,
  snapshot,
} from "./device.js";
import { openAppAndVerifyForeground } from "./recipe-runner-app.js";
import { appStepExpectedLabels } from "./semantic-readiness.js";
import {
  cooperativeCheckpointWithTimeout,
  cooperativeCheckpoint,
  requestPause,
  requestResume,
} from "./control.js";
import { publish, now } from "./events.js";
import { runAction, isActionId } from "./actions.js";
import { captureReviewEnterModule, captureReviewEnterRepeat } from "@relay/protocol";
import { describeTarget, type RecipeStep } from "./recipes.js";
import { evaluateSemantic } from "./evaluation.js";
import { setAndroidMobileData } from "./android-mobile-data.js";
import { assertRecipeStepPlatformSupport } from "./recipe-platform-support.js";
import {
  boundRecipeWaitMs,
  captureStillScreenFingerprint,
  RECIPE_TRANSIENT_PRESENCE_DRAIN_MS,
  RECIPE_TRANSIENT_PRESENCE_SLEEP_MS,
  waitForTargetVisible,
} from "./still-screen-wait.js";
import { isIosRunnerPresenceDrainError } from "./ios-runtime-recovery.js";
import {
  runAppBackgroundStep,
  runEvaluateVisualStep,
  runIdentityIgnoreStep,
  runJudgeConsensus,
  runOfflineStep,
  runUploadStep,
} from "./recipe-runner-qa-steps.js";
import { labelsForIdentifierPrefix, labelsForScope } from "./recipe-target-match.js";
import { runLayoutAssertionStep } from "./recipe-runner-layout-assertion.js";
import { runTourStep } from "./recipe-runner-tour.js";
import { captureRecipeScreenshot, runExpectScreenStep } from "./recipe-runner-screen.js";
import { runCampaignCheck } from "./recipe-runner-campaign-checks.js";
import { runReusableRecipe } from "./recipe-runner-reusable.js";
import {
  runCaptureSurfaceStep,
  runScrollOrRevealStep,
  runTapStep,
  runTypeStep,
} from "./recipe-runner-extended-steps.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";
import { rethrowInputOutcomeUnknown } from "./input-not-dispatched.js";
export { refMatchesRecordedTarget, screenIdentityMatches } from "./recipe-target-match.js";

async function runRequiredRecipeStep(
  device: Device,
  step: RecipeStep,
  ctx: RecipeStepContext,
): Promise<void> {
  const { log, job } = ctx;
  rejectForbiddenCoverageEffect(step, ctx);
  assertRecipeStepPlatformSupport(step);
  if (stepBreaksVerifiedScreen(step)) invalidateVerifiedScreen(ctx);
  switch (step.kind) {
    case "tap":
      try {
        await runTapStep(device, step, ctx);
        if (step.coverage === "transition") {
          job?.artifacts.push({
            kind: "coverage-step-result",
            capturedAt: now(),
            data: {
              reason: "transition-executed" as const,
              coverage: "transition" as const,
              stepId: step.id,
              stepKind: step.kind,
            },
          });
          log(describeCoverageStepReason("transition-executed"));
        }
      } finally {
        invalidateVerifiedScreen(ctx);
      }
      break;
    case "type": {
      try {
        await runTypeStep(device, step, ctx);
      } finally {
        invalidateVerifiedScreen(ctx);
      }
      break;
    }
    case "scroll":
    case "reveal":
      await runScrollOrRevealStep(device, step, ctx);
      break;
    case "swipe": {
      invalidateVerifiedScreen(ctx);
      const { from, to, durationMs } = step;
      await swipeGesture(
        device,
        await resolvePointForDevice(device, from),
        await resolvePointForDevice(device, to),
        durationMs ?? 250,
      );
      break;
    }
    case "key":
      invalidateVerifiedScreen(ctx);
      await pressKey(device, step.key);
      break;
    case "sleep":
      invalidateVerifiedScreen(ctx);
      await sleep(step.ms, device);
      break;
    case "screenshot": {
      await captureRecipeScreenshot(
        device,
        step.caption,
        ctx,
        {},
        {
          ...(step.review ? { review: step.review } : {}),
          ...(step.id ? { stepId: step.id } : {}),
        },
      );
      break;
    }
    case "capture-surface": {
      try {
        await runCaptureSurfaceStep(step, ctx);
      } finally {
        if (step.forceRecapture === true) invalidateVerifiedScreen(ctx);
      }
      break;
    }
    case "tour":
      await runTourStep(device, step, log, job);
      break;
    case "wait-for": {
      const target = step.target;
      if (!target.identifier && !target.ref && !target.label && !target.text) {
        throw new Error(`wait-for: target has no identifier/ref/label/text`);
      }
      await waitForTargetVisible({
        present: () => targetPresent(device, target),
        captureFingerprint: () => captureStillScreenFingerprint(device),
        sleep: (ms) => sleep(ms, device),
        timeoutMs: boundRecipeWaitMs(step.timeoutMs),
        kind: "wait-for",
        expected: describeTarget(target),
        log: ctx.log,
        isTransientPresenceError: isIosRunnerPresenceDrainError,
        transientBudgetMs: RECIPE_TRANSIENT_PRESENCE_DRAIN_MS,
        transientSleepMs: RECIPE_TRANSIENT_PRESENCE_SLEEP_MS,
      });
      break;
    }
    case "wait-response":
      await waitForResponseCompletion(device, step, ctx);
      break;
    case "expect": {
      const target = step.target;
      const timeout = boundRecipeWaitMs(step.timeoutMs, DEFAULT_EXPECT_TIMEOUT_MS);
      const timeoutSec = Math.round(timeout / 1000);
      const label = describeTarget(target);

      if (step.condition === "visible") {
        try {
          if (!target.identifier && !target.ref && !target.label && !target.text) {
            throw new Error(`expect: target has no identifier/ref/label/text`);
          }
          await waitForTargetVisible({
            present: () => targetPresent(device, target),
            captureFingerprint: () => captureStillScreenFingerprint(device),
            sleep: (ms) => sleep(ms, device),
            timeoutMs: timeout,
            kind: "expect",
            expected: label,
            log: ctx.log,
            isTransientPresenceError: isIosRunnerPresenceDrainError,
            transientBudgetMs: RECIPE_TRANSIENT_PRESENCE_DRAIN_MS,
            transientSleepMs: RECIPE_TRANSIENT_PRESENCE_SLEEP_MS,
          });
        } catch (err) {
          if (isCancel(err)) throw err;
          // Infrastructure failures (no device / adb / session / connection)
          // keep their original message — only a real not-found/timeout
          // becomes the assertion failure.
          if (!isNotFoundOrTimeout(err)) throw err;
          throw new Error(`expect: "${label}" not visible after ${timeoutSec}s`);
        }
      } else {
        // condition === "gone": poll until the target no longer resolves.
        const end = Date.now() + timeout;
        if (!(await pollUntil(device, end, async () => !(await targetPresent(device, target))))) {
          throw new Error(`expect: "${label}" still visible after ${timeoutSec}s`);
        }
      }
      break;
    }
    case "expect-set": {
      const timeout = Math.min(step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS);
      const deadline = Date.now() + timeout;
      const expected = [...new Set(step.labels)].sort((a, b) => a.localeCompare(b));
      const allowExtras = step.extras === "allow";
      let observed: string[] = [];
      let attempt = 0;
      while (attempt === 0 || Date.now() <= deadline) {
        attempt += 1;
        await cooperativeCheckpoint();
        const nodes = await snapshot(device);
        observed = step.scope
          ? labelsForScope(nodes, step.scope)
          : labelsForIdentifierPrefix(nodes, step.identifierPrefix ?? "");
        const missing = expected.filter((label) => !observed.includes(label));
        const unexpected = observed.filter((label) => !expected.includes(label));
        if (missing.length === 0 && (allowExtras || unexpected.length === 0)) break;
        if (Date.now() >= deadline) break;
        await sleep(Math.max(0, Math.min(400, deadline - Date.now())), device);
      }
      const missing = expected.filter((label) => !observed.includes(label));
      const unexpected = observed.filter((label) => !expected.includes(label));
      if (missing.length > 0 || (!allowExtras && unexpected.length > 0)) {
        const missing = expected.filter((label) => !observed.includes(label));
        const unexpected = observed.filter((label) => !expected.includes(label));
        const scopeDescription = step.scope
          ? "within " + describeTarget(step.scope)
          : "under " + (step.identifierPrefix ?? "");
        throw new Error(
          "expect-set: options did not match " +
            scopeDescription +
            " (missing: " +
            (missing.length ? missing.join(", ") : "none") +
            "; unexpected: " +
            (allowExtras || unexpected.length === 0 ? "none" : unexpected.join(", ")) +
            ")",
        );
      }
      break;
    }
    case "assert-layout": {
      await runLayoutAssertionStep(device, step, {
        log,
        artifacts: job?.artifacts ?? ctx.artifacts,
      });
      break;
    }
    case "expect-screen": {
      await runExpectScreenStep(device, boundCoverageExpectScreen(step, ctx), ctx);
      break;
    }
    case "extract": {
      const variables = job?.resolvedInputs ?? ctx.variables;
      if (!variables) throw new Error("extract: no execution context");
      const nodes = await snapshot(device);
      const assistant =
        step.role === "assistant"
          ? extractCurrentActionAssistantTurn(nodes, step.target, ctx.runtime?.responseBoundary)
          : undefined;
      const text = assistant?.text ?? extractJoinedTargetText(nodes, step.target);
      variables[step.as] = text;
      (job?.artifacts ?? ctx.artifacts)?.push({
        kind: "conversation-turn",
        capturedAt: now(),
        data: {
          role: step.role ?? "assistant",
          capturedAt: now(),
          source: "accessibility",
          blocks: [{ type: "text", text }],
          variable: step.as,
          ...(assistant
            ? {
                responseId: assistant.responseId,
                initiatingActionId: assistant.initiatingActionId,
                observation: assistant.observation,
                target: assistant.target,
              }
            : {}),
        },
      });
      log(`extract: saved ${step.as} (${text.length} characters)`);
      break;
    }
    case "assert-content": {
      const actual = readInput(ctx, step.input);
      const passed = contentAssertionPassed(actual, step.expected, step.match, step.field);
      const provenance = conversationProvenanceFromArtifacts(job?.artifacts ?? ctx.artifacts);
      (job?.artifacts ?? ctx.artifacts)?.push({
        kind: "content-assertion",
        capturedAt: now(),
        data: {
          input: step.input,
          expected: step.expected,
          match: step.match,
          passed,
          ...provenance,
        },
      });
      if (!passed) {
        throw new Error(
          `content assertion: ${step.input} did not satisfy ${step.match} ${JSON.stringify(step.expected)}`,
        );
      }
      log(`content assertion: passed (${step.match})`);
      break;
    }
    case "evaluate-semantic": {
      const input = readInput(ctx, step.input);
      await runJudgeConsensus(
        (provider, model) =>
          evaluateSemantic({
            input,
            criteria: step.criteria,
            threshold: step.threshold,
            provider,
            model,
          }),
        step,
        ctx,
        "semantic-evaluation",
        "semantic assertion",
      );
      break;
    }
    case "evaluate-visual":
      await runEvaluateVisualStep(device, step, ctx);
      break;
    case "identity-ignore":
      runIdentityIgnoreStep(step, ctx);
      break;
    case "offline":
      await runOfflineStep(device, step, ctx);
      break;
    case "upload":
      await runUploadStep(device, step, ctx);
      break;
    case "pause": {
      if (!job) throw new Error("pause: no job to pause (standalone step execution)");
      const checkpointStartedAt = now();
      const checkpointTimeoutMs = boundedHumanCheckpointTimeoutMs(
        step.timeoutMs ?? ctx.defaultHumanCheckpointTimeoutMs,
      );
      const reason = step.reason ?? "other";
      const resumeLabel = step.resumeLabel ?? "Continue test";
      log(`⏸ ${step.message}`);
      job.status = "paused";
      job.waitingFor = {
        kind: "human",
        message: step.message,
        reason,
        resumeLabel,
        since: checkpointStartedAt,
        timeoutMs: checkpointTimeoutMs,
        ...(step.verifyAfter
          ? {
              verifyAfter: {
                ...step.verifyAfter,
                condition: step.verifyAfter.condition ?? "visible",
              },
            }
          : {}),
      };
      job.artifacts.push({
        kind: "human-intervention-requested",
        capturedAt: checkpointStartedAt,
        data: {
          reason,
          message: step.message,
          resumeLabel,
          timeoutMs: checkpointTimeoutMs,
        },
      });
      requestPause(job.id);
      publish({ type: "job.paused", at: now(), jobId: job.id, action: job.action });
      publish({
        type: "job.log",
        at: now(),
        jobId: job.id,
        line: `==> waiting for you: ${step.message}`,
        level: "info",
      });
      // Blocks until resumeJob (POST /jobs/:id/resume) calls requestResume.
      // On cancel, throws JobCancelledError and propagates up — never sets running.
      try {
        await cooperativeCheckpointWithTimeout(job.id, checkpointTimeoutMs);
      } catch (error) {
        if (!(error instanceof Error && error.name === "JobCancelledError")) {
          job.artifacts.push({
            kind: "human-intervention-expired",
            capturedAt: now(),
            data: {
              reason,
              message: step.message,
              waitedMs: now() - checkpointStartedAt,
              timeoutMs: checkpointTimeoutMs,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
        throw error;
      } finally {
        // A timeout or cancellation must also wake the cooperative waiter.
        requestResume(job.id);
        job.waitingFor = undefined;
      }
      job.artifacts.push({
        kind: "human-intervention-completed",
        capturedAt: now(),
        data: {
          reason,
          message: step.message,
          waitedMs: now() - checkpointStartedAt,
        },
      });
      // resumeJob already set status="running" + published job.resumed; ensure it.
      job.status = "running";
      if (step.verifyAfter) {
        const verificationStartedAt = now();
        const condition = step.verifyAfter.condition ?? "visible";
        try {
          await runRecipeStep(
            device,
            {
              kind: "expect",
              target: step.verifyAfter.target,
              condition,
              ...(step.verifyAfter.timeoutMs !== undefined
                ? { timeoutMs: step.verifyAfter.timeoutMs }
                : {}),
            },
            ctx,
          );
          job.artifacts.push({
            kind: "human-intervention-verified",
            capturedAt: now(),
            data: {
              passed: true,
              target: step.verifyAfter.target,
              condition,
              durationMs: now() - verificationStartedAt,
            },
          });
          log(`human checkpoint: verified ${describeTarget(step.verifyAfter.target)} ${condition}`);
        } catch (error) {
          job.artifacts.push({
            kind: "human-intervention-verified",
            capturedAt: now(),
            data: {
              passed: false,
              target: step.verifyAfter.target,
              condition,
              durationMs: now() - verificationStartedAt,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        }
      }
      break;
    }
    case "review": {
      if (!job) throw new Error("review: no job to annotate");
      const context = job.operationContext;
      const review = {
        schemaVersion: 1 as const,
        status: "pending" as const,
        capability: step.capability,
        reason: step.reason,
        requestedAt: now(),
        ...(context ? { requestedBy: { id: context.actorId, kind: context.actorKind } } : {}),
      };
      job.review = review;
      job.artifacts.push({ kind: "review-required", capturedAt: review.requestedAt, data: review });
      log(`? needs review · ${step.capability}: ${step.reason}`);
      break;
    }
    case "flow": {
      if (!isActionId(step.flow)) {
        throw new Error(`flow step references unknown action: ${step.flow}`);
      }
      const result = await runAction(device, step.flow, { onLog: log });
      if (!result.ok) throw new Error(result.error);
      break;
    }
    case "module": {
      await runReusableRecipe(
        device,
        step.recipeId,
        { ...ctx, captureReview: captureReviewEnterModule(ctx.captureReview, step.recipeId) },
        runRecipeStep,
        step.bindings,
      );
      break;
    }
    case "branch": {
      const key = step.input.replace(/^\{\{\s*|\s*\}\}$/g, "");
      const actual = job?.resolvedInputs[key];
      const matched =
        step.operator === "exists"
          ? actual !== undefined && actual.length > 0
          : step.operator === "equals"
            ? actual === step.expected
            : step.operator === "not-equals"
              ? actual !== step.expected
              : actual?.includes(step.expected ?? "") === true;
      const recipeId = matched ? step.thenRecipeId : step.elseRecipeId;
      job?.artifacts.push({
        kind: "branch-decision",
        capturedAt: now(),
        data: { input: key, operator: step.operator, expected: step.expected, matched, recipeId },
      });
      log(
        `branch: ${matched ? "matched" : "otherwise"}${recipeId ? ` → ${recipeId}` : " → continue"}`,
      );
      if (recipeId) {
        await runReusableRecipe(
          device,
          recipeId,
          { ...ctx, captureReview: captureReviewEnterModule(ctx.captureReview, recipeId) },
          runRecipeStep,
        );
      }
      break;
    }
    case "repeat": {
      for (let iteration = 0; iteration < step.count; iteration += 1) {
        await cooperativeCheckpoint(job?.id);
        if (job) job.resolvedInputs.iteration = String(iteration + 1);
        log(`repeat: ${iteration + 1}/${step.count}`);
        await runReusableRecipe(
          device,
          step.recipeId,
          {
            ...ctx,
            captureReview: captureReviewEnterRepeat(ctx.captureReview, step.recipeId, iteration),
          },
          runRecipeStep,
        );
      }
      job?.artifacts.push({
        kind: "loop",
        capturedAt: now(),
        data: { recipeId: step.recipeId, count: step.count },
      });
      break;
    }
    case "script": {
      const before = { ...job?.resolvedInputs };
      runVariableScript(step.source, ctx);
      job?.artifacts.push({
        kind: "variable-script",
        capturedAt: now(),
        data: { source: step.source, before, after: { ...job?.resolvedInputs } },
      });
      log("script: variables transformed safely");
      break;
    }
    case "clipboard": {
      if (step.action === "write") {
        await clipboardWrite(device, step.text ?? "");
      } else if (step.action === "paste") {
        // Omitting text means "paste what the previous copy/read left in the
        // system clipboard". This mirrors a human copy → paste gesture and
        // keeps the YAML readable; explicit text remains the atomic,
        // cross-platform path for generated values.
        const text = step.text ?? (await clipboardRead(device));
        await clipboardPaste(device, text, step.target!);
        log(`clipboard: pasted ${text.length} character(s) through the system menu`);
      } else if (step.action === "copy") {
        const value = await clipboardCopy(device, step.target!, step.expect);
        log(`clipboard: copied ${value.length} character(s) through the system menu`);
        if (step.expect !== undefined) {
          const ok =
            step.match === "contains" ? value.includes(step.expect) : value === step.expect;
          if (!ok) throw clipboardExpectationError(value, step.expect, step.match);
        }
      } else {
        const value = await clipboardRead(device);
        log(`clipboard: read ${value.length} character(s)`);
        if (step.expect !== undefined) {
          const ok =
            step.match === "contains" ? value.includes(step.expect) : value === step.expect;
          if (!ok) {
            throw clipboardExpectationError(value, step.expect, step.match);
          }
        }
      }
      break;
    }
    case "app": {
      if (step.action === "background") {
        await runAppBackgroundStep(device, step, ctx);
        break;
      }
      if (step.action === "switcher") {
        await openAppSwitcher(device);
        break;
      }
      if (step.action === "close") {
        await closeApp(device, step.app);
        break;
      }
      if (step.action === "open") {
        if (step.url) await openUrl(device, step.url);
        else
          await openAppAndVerifyForeground(
            device,
            step.app!,
            step.relaunch === undefined ? undefined : { relaunch: step.relaunch },
            log,
          );
        const expectedLabels = appStepExpectedLabels(step);
        if (expectedLabels.length && isAndroidSemanticReadinessTarget()) {
          await awaitAndroidSemanticReadiness(device, expectedLabels, ctx);
          log(`semantic readiness: ${expectedLabels.join(", ")}`);
        }
        break;
      }
      if (step.action === "set-locale") {
        await setAndroidAppLocale(step.app!, step.locale!);
        log(`app locale: ${step.app} → ${step.locale}`);
        break;
      }
      const build =
        step.action === "install" || step.action === "update" || step.action === "uninstall"
          ? await changeAndroidAppBuild({
              action: step.action,
              packageName: step.app!,
              artifact: step.artifact,
            })
          : await inspectAndroidApp(step.app!);
      const expected = step.version;
      const versionMatches =
        expected === undefined
          ? undefined
          : step.versionMatch === "contains"
            ? build.versionName?.includes(expected) === true
            : build.versionName === expected;

      job?.artifacts.push({
        kind: "app-build",
        capturedAt: now(),
        data: {
          action: step.action,
          ...build,
          ...(expected !== undefined
            ? {
                expectedVersion: expected,
                versionMatch: step.versionMatch ?? "exact",
                versionMatches,
              }
            : {}),
          ...(step.artifact ? { artifact: step.artifact } : {}),
        },
      });
      if (build.versionName) {
        if (job) {
          job.appVersion = build.versionName;
          job.resolvedInputs[step.as ?? "app_version"] = build.versionName;
        }
      }
      log(
        `app build: ${build.packageName} · ${build.installed ? (build.versionName ?? "installed (version unavailable)") : "not installed"}`,
      );
      if (step.action === "assert-installed" && !build.installed) {
        throw new Error(`app build: ${step.app} is not installed`);
      }
      if (step.action === "assert-not-installed" && build.installed) {
        throw new Error(
          `app build: ${step.app} is installed (${build.versionName ?? "version unavailable"})`,
        );
      }
      if (expected !== undefined && versionMatches === false) {
        throw new Error(
          `app build: ${step.app} version ${JSON.stringify(build.versionName ?? "unknown")} does not ${step.versionMatch === "contains" ? "contain" : "equal"} ${JSON.stringify(expected)}`,
        );
      }
      break;
    }
    case "device":
      if (step.action === "lock" || step.action === "unlock")
        await setAndroidLockState(step.action);
      else await keyboardAction(device, step.action === "keyboard-dismiss" ? "dismiss" : "enter");
      break;
    case "rotate":
      // The confirmed rotation advances the iOS input fence, which re-keys
      // runtimeBoundsCache; no explicit invalidation is needed here.
      await rotateDevice(device, step.orientation);
      break;
    case "settings": {
      if (step.setting === "mobile-data") {
        if (step.state !== "on" && step.state !== "off") {
          throw new Error('settings mobile-data requires state: "on" | "off"');
        }
        await setAndroidMobileData(step.state);
        job?.artifacts.push({
          kind: "device-setting",
          capturedAt: now(),
          data: { setting: "mobile-data", state: step.state },
        });
        break;
      }
      const common = { ...base(), setting: step.setting };
      const result =
        step.setting === "appearance"
          ? await updateSetting(device, {
              ...common,
              setting: "appearance",
              state: step.state as "light" | "dark" | "toggle",
            })
          : await updateSetting(device, {
              ...common,
              setting: step.setting as "wifi" | "airplane" | "location" | "animations",
              state: step.state as "on" | "off",
            });
      job?.artifacts.push({ kind: "device-setting", capturedAt: now(), data: result });
      break;
    }
    case "location": {
      const result = await updateSetting(device, {
        ...base(),
        setting: "location",
        state: "set",
        latitude: step.latitude,
        longitude: step.longitude,
      });
      job?.artifacts.push({ kind: "location", capturedAt: now(), data: result });
      break;
    }
    case "permission": {
      const result = await updateSetting(device, {
        ...base(),
        setting: "permission",
        state: step.action,
        permission: step.permission,
      });
      job?.artifacts.push({ kind: "permission", capturedAt: now(), data: result });
      break;
    }
    case "alert": {
      const result = await alertAction(device, step.action, step.timeoutMs);
      job?.artifacts.push({ kind: "alert", capturedAt: now(), data: result });
      break;
    }
    case "network": {
      const include = step.include ?? "summary";
      if (
        (include === "body" || include === "all") &&
        !ctx.job?.evidencePolicy?.sensitive["network-body"]
      ) {
        throw new Error("network body capture requires consent in Settings → Privacy & evidence");
      }
      const result = await captureNetwork(device, {
        action: step.action,
        include,
        limit: step.limit,
      });
      job?.artifacts.push({ kind: "network", capturedAt: now(), data: result });
      log(`network: captured ${include}`);
      break;
    }
    case "logs": {
      const result = await manageLogs(device, { action: step.action, message: step.message });
      job?.artifacts.push({ kind: "device-log", capturedAt: now(), data: result });
      break;
    }
  }
}

export async function runRecipeStep(
  device: Device,
  step: RecipeStep,
  ctx: RecipeStepContext,
): Promise<void> {
  ctx.runtime ??= {};
  if (step.when) {
    invalidateVerifiedScreen(ctx);
    const present = await conditionalTargetPresent(device, step.when);
    const shouldRun = step.when.condition === "present" ? present : !present;
    if (!shouldRun && leftoverSkipForbidden(step)) {
      // Coverage:transition leftover skip cannot prove the required opener.
    } else if (!shouldRun) {
      const inspectSkip = inspectSetupSkip(step);
      const message = inspectSkip
        ? describeCoverageStepReason("inspect-setup-skipped")
        : `${describeTarget(step.when.target)} is ${present ? "present" : "absent"}`;
      ctx.log(inspectSkip ? message : `conditional ${step.kind}: skipped — ${message}`);
      ctx.job?.artifacts.push({
        kind: "conditional-step-skipped",
        capturedAt: now(),
        data: {
          stepId: step.id,
          stepKind: step.kind,
          condition: step.when.condition,
          target: step.when.target,
          observed: present ? "present" : "absent",
          ...(inspectSkip
            ? { reason: "inspect-setup-skipped" as const, coverage: "inspect" as const }
            : {}),
        },
      });
      return;
    }
  }
  if (step.check) {
    await runCampaignCheck(
      device,
      step as RecipeStep & { check: NonNullable<RecipeStep["check"]> },
      ctx,
      (recipeId, bindings) =>
        runRequiredRecipeStep(device, campaignExecutionStep(step, recipeId, bindings), ctx),
    );
    return;
  }
  if (!step.optional) {
    await runRequiredRecipeStep(device, step, ctx);
    return;
  }
  try {
    await runRequiredRecipeStep(device, step, ctx);
  } catch (error) {
    rethrowIosMutationOutcomeUnknown(error);
    rethrowInputOutcomeUnknown(error);
    if (isCancel(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    ctx.log(`optional ${step.kind}: skipped — ${message}`);
    ctx.job?.artifacts.push({
      kind: "optional-step-skipped",
      capturedAt: now(),
      data: { stepId: step.id, stepKind: step.kind, message },
    });
  }
}
