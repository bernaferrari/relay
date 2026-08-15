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
  resolveRecipeStep,
  runtimeBoundsCache,
  runVariableScript,
  targetPresent,
  waitForResponseCompletion,
} from "./recipe-runner-support.js";
import {
  invalidateVerifiedScreen,
  stepBreaksVerifiedScreen,
  type RecipeStepContext,
} from "./recipe-runner-context.js";
export { isRightToLeftRun, resolveRecipeStep } from "./recipe-runner-support.js";
export type { RecipeStepContext } from "./recipe-runner-context.js";
import {
  pressKey,
  sleep,
  swipeGesture,
  waitFor,
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
import {
  cooperativeCheckpointWithTimeout,
  cooperativeCheckpoint,
  requestPause,
  requestResume,
} from "./control.js";
import { publish, now } from "./events.js";
import { runAction, isActionId } from "./actions.js";
import { captureScreenshot } from "./workspace.js";
import { describeTarget, readRecipe, type RecipeStep } from "./recipes.js";
import { evaluateSemantic } from "./evaluation.js";
import {
  nodeText,
  nodeMatchesTarget,
  labelsForIdentifierPrefix,
  labelsForScope,
} from "./recipe-target-match.js";
import { runTourStep } from "./recipe-runner-tour.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import {
  runCampaignCheck,
  runCaptureSurfaceStep,
  runScrollOrRevealStep,
  runTapStep,
  runTypeStep,
} from "./recipe-runner-extended-steps.js";
export { refMatchesRecordedTarget, screenIdentityMatches } from "./recipe-target-match.js";

async function runReusableRecipe(
  device: Device,
  recipeId: string,
  ctx: RecipeStepContext,
  bindings?: Record<string, string>,
): Promise<void> {
  const stack = ctx.moduleStack ?? [];
  if (stack.includes(recipeId))
    throw new Error(`reusable test cycle: ${[...stack, recipeId].join(" → ")}`);
  if (stack.length >= 12) throw new Error("reusable test nesting is limited to 12 levels");
  const recipe = ctx.recipeGraph?.[recipeId] ?? (await readRecipe(recipeId));
  if (!recipe) throw new Error(`reusable test not found: ${recipeId}`);
  const current = ctx.job?.resolvedInputs;
  const parameters = recipe.parameters ?? [];
  const declared = new Set(parameters.map((parameter) => parameter.name));
  for (const name of Object.keys(bindings ?? {})) {
    if (!declared.has(name)) {
      throw new Error(`reusable flow ${recipe.title} does not declare input ${name}`);
    }
  }

  const touched = new Map<string, string | undefined>();
  const resolved: Record<string, string> = {};
  if (current) {
    const overlay: Record<string, string> = { ...recipe.variables };
    for (const parameter of parameters) {
      const value =
        bindings?.[parameter.name] ??
        current[parameter.name] ??
        parameter.default ??
        recipe.variables?.[parameter.name];
      if (value === undefined && parameter.required) {
        throw new Error(`reusable flow ${recipe.title} requires input ${parameter.name}`);
      }
      if (value !== undefined) {
        overlay[parameter.name] = value;
        resolved[parameter.name] = value;
      }
    }
    for (const [name, value] of Object.entries(overlay)) {
      touched.set(name, current[name]);
      current[name] = value;
    }
    if (parameters.length > 0) {
      ctx.job?.artifacts.push({
        kind: "reusable-flow-inputs",
        capturedAt: now(),
        data: {
          recipeId: recipe.id,
          title: recipe.title,
          declared: parameters.map(({ name, required, default: defaultValue }) => ({
            name,
            ...(required ? { required: true } : {}),
            ...(defaultValue !== undefined ? { default: defaultValue } : {}),
          })),
          bindings: bindings ?? {},
          resolved,
        },
      });
    }
  }
  ctx.log(
    `↳ ${recipe.title} · ${recipe.steps.length} step(s)${parameters.length ? ` · ${Object.keys(resolved).length}/${parameters.length} inputs` : ""}`,
  );
  try {
    for (const child of recipe.steps) {
      await runRecipeStep(device, resolveRecipeStep(child, ctx.job?.resolvedInputs ?? {}), {
        ...ctx,
        moduleStack: [...stack, recipeId],
      });
    }
  } finally {
    if (current) {
      for (const [name, previous] of touched) {
        if (previous === undefined) delete current[name];
        else current[name] = previous;
      }
    }
  }
}

async function runRequiredRecipeStep(
  device: Device,
  step: RecipeStep,
  ctx: RecipeStepContext,
): Promise<void> {
  const { log, job } = ctx;
  if (stepBreaksVerifiedScreen(step)) invalidateVerifiedScreen(ctx);
  switch (step.kind) {
    case "tap":
      try {
        await runTapStep(device, step, ctx);
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
      invalidateVerifiedScreen(ctx);
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
      // Time alone can make an asynchronous UI tree stale.
      invalidateVerifiedScreen(ctx);
      await sleep(step.ms, device);
      break;

    case "screenshot": {
      const verified = ctx.runtime?.verifiedScreen;
      const screenshot = await captureScreenshot({
        jobId: job?.id,
        caption: step.caption,
        device,
        // Preserve screenshot screen-match evidence while avoiding a second
        // Android tree walk after an immediately preceding semantic proof.
        ...(verified ? { semanticNodes: verified.nodes } : {}),
      });
      if (verified) verified.screenshot = screenshot;
      break;
    }

    case "capture-surface": {
      try {
        await runCaptureSurfaceStep(step, ctx);
      } finally {
        invalidateVerifiedScreen(ctx);
      }
      break;
    }

    case "tour":
      await runTourStep(device, step, log, job);
      break;

    case "wait-for": {
      const target = step.target;
      const timeout = Math.min(step.timeoutMs ?? 30_000, MAX_WAIT_MS);
      if (target.identifier || target.ref) {
        const end = Date.now() + timeout;
        let found = false;
        while (Date.now() < end) {
          await cooperativeCheckpoint();
          if (await targetPresent(device, target)) {
            found = true;
            break;
          }
          await sleep(400, device);
        }
        if (!found) {
          throw new Error(
            `wait-for: timed out waiting for ${describeTarget(target)} (${timeout}ms)`,
          );
        }
      } else if (target.label) {
        await waitFor(device, { text: target.label }, timeout);
      } else if (target.text) {
        await waitFor(device, { query: target.text }, timeout);
      } else {
        // Validation rejects point-only / empty targets, but guard defensively.
        throw new Error(`wait-for: target has no identifier/ref/label/text`);
      }
      break;
    }

    case "wait-response":
      await waitForResponseCompletion(device, step, ctx);
      break;

    case "expect": {
      const target = step.target;
      const timeout = Math.min(step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS);
      const timeoutSec = Math.round(timeout / 1000);
      const label = describeTarget(target);

      if (step.condition === "visible") {
        try {
          if (target.identifier || target.ref) {
            const end = Date.now() + timeout;
            let found = false;
            while (Date.now() < end) {
              await cooperativeCheckpoint();
              if (await targetPresent(device, target)) {
                found = true;
                break;
              }
              await sleep(400, device);
            }
            if (!found) throw new Error(`timed out waiting for ${describeTarget(target)}`);
          } else if (target.label) {
            await waitFor(device, { text: target.label }, timeout);
          } else if (target.text) {
            await waitFor(device, { query: target.text }, timeout);
          } else {
            // Validation rejects point-only / empty targets, but guard defensively.
            throw new Error(`expect: target has no identifier/ref/label/text`);
          }
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
        let gone = false;
        while (Date.now() < end) {
          await cooperativeCheckpoint();
          if (!(await targetPresent(device, target))) {
            gone = true;
            break;
          }
          await sleep(400, device);
        }
        if (!gone) {
          throw new Error(`expect: "${label}" still visible after ${timeoutSec}s`);
        }
      }
      break;
    }

    case "expect-set": {
      const timeout = Math.min(step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS);
      const deadline = Date.now() + timeout;
      const expected = [...new Set(step.labels)].sort((a, b) => a.localeCompare(b));
      let observed: string[] = [];
      let attempt = 0;
      while (attempt === 0 || Date.now() <= deadline) {
        attempt += 1;
        await cooperativeCheckpoint();
        const nodes = await snapshot(device);
        observed = step.scope
          ? labelsForScope(nodes, step.scope)
          : labelsForIdentifierPrefix(nodes, step.identifierPrefix ?? "");
        if (JSON.stringify(observed) === JSON.stringify(expected)) break;
        if (Date.now() >= deadline) break;
        await sleep(Math.max(0, Math.min(400, deadline - Date.now())), device);
      }
      if (JSON.stringify(observed) !== JSON.stringify(expected)) {
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
            (unexpected.length ? unexpected.join(", ") : "none") +
            ")",
        );
      }
      break;
    }

    case "expect-screen": {
      await runExpectScreenStep(device, step, ctx);
      break;
    }

    case "extract": {
      const variables = job?.resolvedInputs ?? ctx.variables;
      if (!variables) throw new Error("extract: no execution context");
      const nodes = await snapshot(device);
      const matches = nodes.filter((node) => nodeMatchesTarget(node, step.target));
      const values = [...new Set(matches.flatMap(nodeText))];
      if (values.length === 0) {
        throw new Error(`extract: no accessible content matched ${describeTarget(step.target)}`);
      }
      const text = values.join("\n");
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
        },
      });
      log(`extract: saved ${step.as} (${text.length} characters)`);
      break;
    }

    case "assert-content": {
      const actual = readInput(ctx, step.input);
      const passed =
        step.match === "exact"
          ? actual === step.expected
          : step.match === "contains"
            ? actual.includes(step.expected)
            : !actual.includes(step.expected);
      (job?.artifacts ?? ctx.artifacts)?.push({
        kind: "content-assertion",
        capturedAt: now(),
        data: { input: step.input, expected: step.expected, match: step.match, passed },
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
      const evaluate = (provider?: string, model?: string) =>
        evaluateSemantic({
          input,
          criteria: step.criteria,
          threshold: step.threshold,
          provider,
          model,
        });

      if (step.requireAgreement) {
        // Independent judges are deliberately started together. This keeps
        // multi-model verification from doubling latency while preserving a
        // separate artifact and provenance record for every judge.
        const [firstOutcome, secondOutcome] = await Promise.allSettled([
          evaluate(step.provider, step.model),
          evaluate(step.secondProvider, step.secondModel),
        ]);
        if (firstOutcome.status === "rejected") {
          const summary = `Primary judge unavailable: ${firstOutcome.reason instanceof Error ? firstOutcome.reason.message : String(firstOutcome.reason)}`;
          job?.artifacts.push({
            kind: "judge-consensus",
            capturedAt: now(),
            data: {
              status: "uncertain",
              error: summary,
              second:
                secondOutcome.status === "fulfilled"
                  ? { ...secondOutcome.value, judge: "independent" }
                  : undefined,
            },
          });
          throw new Error(`judge uncertain: ${summary}`);
        }
        const result = firstOutcome.value;
        (job?.artifacts ?? ctx.artifacts)?.push({
          kind: "semantic-evaluation",
          capturedAt: now(),
          data: result,
        });
        log(
          `semantic evaluation: ${result.status} · ${result.score.toFixed(2)} · ${result.summary}`,
        );
        if (secondOutcome.status === "rejected") {
          const summary = `Independent judge unavailable: ${secondOutcome.reason instanceof Error ? secondOutcome.reason.message : String(secondOutcome.reason)}`;
          job?.artifacts.push({
            kind: "judge-consensus",
            capturedAt: now(),
            data: { status: "uncertain", first: result, error: summary },
          });
          throw new Error(`judge uncertain: ${summary}`);
        }
        const second = secondOutcome.value;
        job?.artifacts.push({
          kind: "semantic-evaluation",
          capturedAt: now(),
          data: { ...second, judge: "independent" },
        });
        log(
          `independent evaluation: ${second.status} · ${second.score.toFixed(2)} · ${second.summary}`,
        );
        const agreed = result.status === second.status;
        job?.artifacts.push({
          kind: "judge-consensus",
          capturedAt: now(),
          data: { status: agreed ? result.status : "uncertain", agreed, first: result, second },
        });
        if (!agreed) {
          throw new Error(
            `judge uncertain: judges disagree (${result.provider}: ${result.status}; ${second.provider}: ${second.status})`,
          );
        }
        if (result.status === "uncertain") {
          throw new Error(`judge uncertain: ${result.summary}`);
        }
        if (result.status === "fail") {
          throw new Error(`semantic assertion: ${result.summary}`);
        }
        break;
      }

      const result = await evaluate(step.provider, step.model);
      (job?.artifacts ?? ctx.artifacts)?.push({
        kind: "semantic-evaluation",
        capturedAt: now(),
        data: result,
      });
      log(`semantic evaluation: ${result.status} · ${result.score.toFixed(2)} · ${result.summary}`);
      if (result.status === "uncertain") {
        throw new Error(`judge uncertain: ${result.summary}`);
      }
      if (result.status === "fail") {
        throw new Error(`semantic assertion: ${result.summary}`);
      }
      break;
    }

    case "pause": {
      if (!job) throw new Error("pause: no job to pause (standalone step execution)");
      const checkpointStartedAt = now();
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
        ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
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
          ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
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
        await cooperativeCheckpointWithTimeout(job.id, step.timeoutMs);
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
      // validateRecipeSteps guarantees step.flow is a known ActionId; narrow to satisfy types.
      if (!isActionId(step.flow)) {
        throw new Error(`flow step references unknown action: ${step.flow}`);
      }
      const result = await runAction(device, step.flow, { onLog: log });
      if (!result.ok) throw new Error(result.error);
      break;
    }

    case "module": {
      await runReusableRecipe(device, step.recipeId, ctx, step.bindings);
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
      if (recipeId) await runReusableRecipe(device, recipeId, ctx);
      break;
    }

    case "repeat": {
      for (let iteration = 0; iteration < step.count; iteration += 1) {
        await cooperativeCheckpoint(job?.id);
        if (job) job.resolvedInputs.iteration = String(iteration + 1);
        log(`repeat: ${iteration + 1}/${step.count}`);
        await runReusableRecipe(device, step.recipeId, ctx);
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
      await rotateDevice(device, step.orientation);
      runtimeBoundsCache.delete(device);
      break;

    case "settings": {
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
    if (!shouldRun) {
      const message = `${describeTarget(step.when.target)} is ${present ? "present" : "absent"}`;
      ctx.log(`conditional ${step.kind}: skipped — ${message}`);
      ctx.job?.artifacts.push({
        kind: "conditional-step-skipped",
        capturedAt: now(),
        data: {
          stepId: step.id,
          stepKind: step.kind,
          condition: step.when.condition,
          target: step.when.target,
          observed: present ? "present" : "absent",
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
      () => runRequiredRecipeStep(device, step, ctx),
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
