/**
 * Pure recipe validation and step parsing — no filesystem I/O.
 */
import { isActionId } from "./actions.js";
import {
  MAX_WAIT_MS,
  PARAMETER_NAME,
  isNumber,
  isObject,
  isString,
  parseStepMetadata,
  parseStepPoint,
  parseTarget,
  parseTourRuntimeOptions,
  stepErr,
  targetHasStrategy,
} from "./recipe-validation-support.js";
export { validateRecipeParameters } from "./recipe-validation-support.js";
import type { HumanCheckpointReason, RecipeStep, StepTarget } from "@relay/protocol";

export function validateRecipeSteps(steps: unknown): RecipeStep[] {
  if (!Array.isArray(steps)) throw new Error("steps must be an array");
  const out: RecipeStep[] = [];
  steps.forEach((raw, i) => {
    const index = i + 1; // 1-based for human-readable error messages
    if (!isObject(raw)) throw stepErr(index, "must be an object");
    const kind = raw.kind;
    if (!isString(kind)) throw stepErr(index, "kind is required");
    // optional note on every kind
    const note = raw.note !== undefined && isString(raw.note) ? raw.note : undefined;
    switch (kind) {
      case "tap": {
        const target = parseTarget(raw.target, index, "target");
        if (!targetHasStrategy(target)) {
          throw stepErr(
            index,
            "tap requires target with at least one of identifier/ref/label/text/point",
          );
        }
        let fallbackTargets: StepTarget[] | undefined;
        if (raw.fallbackTargets !== undefined) {
          if (!Array.isArray(raw.fallbackTargets) || raw.fallbackTargets.length > 8) {
            throw stepErr(index, "tap.fallbackTargets must contain at most 8 targets");
          }
          fallbackTargets = raw.fallbackTargets.map((fallback, fallbackIndex) => {
            const parsed = parseTarget(fallback, index, `fallbackTargets[${fallbackIndex}]`);
            if (!targetHasStrategy(parsed)) {
              throw stepErr(
                index,
                `tap.fallbackTargets[${fallbackIndex}] must contain a semantic or coordinate target`,
              );
            }
            return parsed;
          });
        }
        if (
          raw.gesture !== undefined &&
          raw.gesture !== "single" &&
          raw.gesture !== "multi" &&
          raw.gesture !== "hold"
        ) {
          throw stepErr(index, 'tap.gesture must be "single", "multi", or "hold"');
        }
        if (
          raw.tapCount !== undefined &&
          (!Number.isInteger(raw.tapCount) ||
            (raw.tapCount as number) < 2 ||
            (raw.tapCount as number) > 10)
        ) {
          throw stepErr(index, "tap.tapCount must be an integer between 2 and 10");
        }
        if (
          raw.intervalMs !== undefined &&
          (!isNumber(raw.intervalMs) || raw.intervalMs < 20 || raw.intervalMs > 2_000)
        ) {
          throw stepErr(index, "tap.intervalMs must be between 20 and 2000");
        }
        if (
          raw.durationMs !== undefined &&
          (!isNumber(raw.durationMs) || raw.durationMs < 100 || raw.durationMs > 10_000)
        ) {
          throw stepErr(index, "tap.durationMs must be between 100 and 10000");
        }
        if (raw.expectedApp !== undefined && !isString(raw.expectedApp)) {
          throw stepErr(index, "tap.expectedApp must be a string");
        }
        const step: Extract<RecipeStep, { kind: "tap" }> = {
          kind: "tap",
          target,
          ...(isString(raw.expectedApp) ? { expectedApp: raw.expectedApp } : {}),
          ...(fallbackTargets?.length ? { fallbackTargets } : {}),
          ...(raw.gesture !== undefined
            ? { gesture: raw.gesture as "single" | "multi" | "hold" }
            : {}),
          ...(raw.tapCount !== undefined ? { tapCount: raw.tapCount as number } : {}),
          ...(raw.intervalMs !== undefined ? { intervalMs: raw.intervalMs as number } : {}),
          ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs as number } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "type": {
        if (!isString(raw.text)) throw stepErr(index, "type requires text: string");
        if (raw.mode !== undefined && raw.mode !== "append" && raw.mode !== "replace") {
          throw stepErr(index, 'type.mode must be "append" or "replace"');
        }
        if (raw.mode === "replace" && raw.target === undefined) {
          throw stepErr(index, "type.target is required when mode is replace");
        }
        const step: Extract<RecipeStep, { kind: "type" }> = {
          kind: "type",
          text: raw.text,
          ...(raw.target !== undefined ? { target: parseTarget(raw.target, index, "target") } : {}),
          ...(raw.mode !== undefined ? { mode: raw.mode as "append" | "replace" } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "scroll": {
        if (raw.direction !== "down" && raw.direction !== "up") {
          throw stepErr(index, 'scroll requires direction: "down" | "up"');
        }
        if (
          raw.maxAttempts !== undefined &&
          (!isNumber(raw.maxAttempts) ||
            !Number.isInteger(raw.maxAttempts) ||
            raw.maxAttempts < 1 ||
            raw.maxAttempts > 48)
        ) {
          throw stepErr(index, "scroll.maxAttempts must be an integer from 1 to 48");
        }
        let until: Extract<RecipeStep, { kind: "scroll" }>["until"];
        if (raw.until !== undefined) {
          if (!isObject(raw.until)) throw stepErr(index, "scroll.until must be an object");
          if (
            !isString(raw.until.screenId) ||
            !raw.until.screenId.trim() ||
            !isString(raw.until.screenTitle) ||
            !raw.until.screenTitle.trim() ||
            !isString(raw.until.fingerprint) ||
            !/^[a-f0-9]{64}$/u.test(raw.until.fingerprint)
          ) {
            throw stepErr(index, "scroll.until needs a mapped screen identity");
          }
          if (
            raw.until.aliases !== undefined &&
            (!Array.isArray(raw.until.aliases) ||
              !raw.until.aliases.every((alias) => isString(alias) && /^[a-f0-9]{64}$/u.test(alias)))
          ) {
            throw stepErr(index, "scroll.until.aliases must be SHA-256 fingerprints");
          }
          if (
            raw.until.observations !== undefined &&
            (!Array.isArray(raw.until.observations) ||
              raw.until.observations.length > 256 ||
              !raw.until.observations.every(
                (observation) =>
                  isObject(observation) &&
                  isString(observation.fingerprint) &&
                  /^[a-f0-9]{64}$/u.test(observation.fingerprint) &&
                  Array.isArray(observation.nodes) &&
                  Array.isArray(observation.volatileSignals),
              ))
          ) {
            throw stepErr(index, "scroll.until.observations must be semantic observations");
          }
          until = structuredClone(raw.until) as NonNullable<typeof until>;
        }
        const step: Extract<RecipeStep, { kind: "scroll" }> = {
          kind: "scroll",
          direction: raw.direction,
          ...(raw.amount !== undefined
            ? isNumber(raw.amount)
              ? { amount: raw.amount }
              : (() => {
                  throw stepErr(index, "scroll.amount must be a number");
                })()
            : {}),
          ...(until ? { until } : {}),
          ...(raw.maxAttempts !== undefined ? { maxAttempts: raw.maxAttempts } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "swipe": {
        const from = parseStepPoint(raw.from, index, "swipe.from");
        const to = parseStepPoint(raw.to, index, "swipe.to");
        let durationMs: number | undefined;
        if (raw.durationMs !== undefined) {
          if (!isNumber(raw.durationMs)) throw stepErr(index, "swipe.durationMs must be a number");
          if (raw.durationMs < 50 || raw.durationMs > 5000) {
            throw stepErr(index, "swipe.durationMs must be between 50 and 5000");
          }
          durationMs = raw.durationMs;
        }
        const step: Extract<RecipeStep, { kind: "swipe" }> = {
          kind: "swipe",
          from,
          to,
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "key": {
        if (raw.key !== "back" && raw.key !== "home") {
          throw stepErr(index, 'key requires key: "back" | "home"');
        }
        const step: Extract<RecipeStep, { kind: "key" }> = {
          kind: "key",
          key: raw.key,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "sleep": {
        if (!isNumber(raw.ms)) throw stepErr(index, "sleep requires ms: number");
        if (raw.ms < 0) throw stepErr(index, "sleep ms must be >= 0");
        const step: Extract<RecipeStep, { kind: "sleep" }> = {
          kind: "sleep",
          ms: raw.ms,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "wait-for": {
        const target = parseTarget(raw.target, index, "target");
        // point-only targets can't be "waited for" (validation-time rejection)
        if (target.point && !target.identifier && !target.ref && !target.label && !target.text) {
          throw stepErr(
            index,
            "wait-for target must have identifier/ref/label/text (point-only is not waitable)",
          );
        }
        if (!targetHasStrategy(target)) {
          throw stepErr(index, "wait-for requires target with identifier/ref/label/text");
        }
        let timeoutMs: number | undefined;
        if (raw.timeoutMs !== undefined) {
          if (!isNumber(raw.timeoutMs)) throw stepErr(index, "wait-for.timeoutMs must be a number");
          if (raw.timeoutMs < 0) throw stepErr(index, "wait-for.timeoutMs must be >= 0");
          if (raw.timeoutMs > MAX_WAIT_MS)
            throw stepErr(index, `wait-for.timeoutMs must be <= ${MAX_WAIT_MS} (15 min)`);
          timeoutMs = raw.timeoutMs;
        }
        const step: Extract<RecipeStep, { kind: "wait-for" }> = {
          kind: "wait-for",
          target,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "wait-response": {
        const target = parseTarget(raw.target, index, "target");
        if (!target.identifier && !target.ref && !target.label && !target.text) {
          throw stepErr(index, "wait-response target requires identifier/ref/label/text");
        }
        const parseOptionalSemanticTarget = (value: unknown, field: string) => {
          if (value === undefined) return undefined;
          const parsed = parseTarget(value, index, field);
          if (!parsed.identifier && !parsed.ref && !parsed.label && !parsed.text) {
            throw stepErr(index, `${field} requires identifier/ref/label/text`);
          }
          return parsed;
        };
        const busyTarget = parseOptionalSemanticTarget(raw.busyTarget, "busyTarget");
        const idleTarget = parseOptionalSemanticTarget(raw.idleTarget, "idleTarget");
        const timeoutMs = raw.timeoutMs === undefined ? undefined : raw.timeoutMs;
        const stableForMs = raw.stableForMs === undefined ? undefined : raw.stableForMs;
        if (!isNumber(timeoutMs) && timeoutMs !== undefined)
          throw stepErr(index, "wait-response.timeoutMs must be a number");
        if (timeoutMs !== undefined && (timeoutMs < 1_000 || timeoutMs > MAX_WAIT_MS)) {
          throw stepErr(index, `wait-response.timeoutMs must be between 1000 and ${MAX_WAIT_MS}`);
        }
        if (!isNumber(stableForMs) && stableForMs !== undefined)
          throw stepErr(index, "wait-response.stableForMs must be a number");
        if (stableForMs !== undefined && (stableForMs < 500 || stableForMs > 30_000)) {
          throw stepErr(index, "wait-response.stableForMs must be between 500 and 30000");
        }
        out.push({
          kind: "wait-response",
          target,
          ...(busyTarget ? { busyTarget } : {}),
          ...(idleTarget ? { idleTarget } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(stableForMs !== undefined ? { stableForMs } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "expect": {
        const target = parseTarget(raw.target, index, "target");
        // point-only targets can't be "expected" (validation-time rejection)
        if (target.point && !target.identifier && !target.ref && !target.label && !target.text) {
          throw stepErr(
            index,
            "expect target must have identifier/ref/label/text (point-only is not checkable)",
          );
        }
        if (!targetHasStrategy(target)) {
          throw stepErr(index, "expect requires target with identifier/ref/label/text");
        }
        if (raw.condition !== "visible" && raw.condition !== "gone") {
          throw stepErr(index, 'expect requires condition: "visible" | "gone"');
        }
        let timeoutMs: number | undefined;
        if (raw.timeoutMs !== undefined) {
          if (!isNumber(raw.timeoutMs)) throw stepErr(index, "expect.timeoutMs must be a number");
          if (raw.timeoutMs < 0) throw stepErr(index, "expect.timeoutMs must be >= 0");
          if (raw.timeoutMs > MAX_WAIT_MS)
            throw stepErr(index, `expect.timeoutMs must be <= ${MAX_WAIT_MS} (15 min)`);
          timeoutMs = raw.timeoutMs;
        }
        const step: Extract<RecipeStep, { kind: "expect" }> = {
          kind: "expect",
          target,
          condition: raw.condition,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "expect-set": {
        let identifierPrefix: string | undefined;
        if (raw.identifierPrefix !== undefined) {
          if (!isString(raw.identifierPrefix)) {
            throw stepErr(index, "expect-set.identifierPrefix must be a string");
          }
          identifierPrefix = raw.identifierPrefix.trim() || undefined;
        }
        let scope: StepTarget | undefined;
        if (raw.scope !== undefined) {
          const parsedScope = parseTarget(raw.scope, index, "expect-set.scope");
          if (
            !parsedScope.identifier &&
            !parsedScope.ref &&
            !parsedScope.label &&
            !parsedScope.text
          ) {
            throw stepErr(index, "expect-set.scope must have identifier, ref, label, or text");
          }
          scope = parsedScope;
        }
        if (!identifierPrefix && !scope) {
          throw stepErr(index, "expect-set requires identifierPrefix or scope");
        }
        if (
          !Array.isArray(raw.labels) ||
          raw.labels.length < 1 ||
          raw.labels.length > 64 ||
          !raw.labels.every((label) => isString(label) && label.trim().length > 0)
        ) {
          throw stepErr(index, "expect-set.labels must contain 1 to 64 non-empty labels");
        }
        const labels = raw.labels.map((label) => label.trim());
        if (new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) {
          throw stepErr(index, "expect-set.labels must be unique");
        }
        let timeoutMs: number | undefined;
        if (raw.timeoutMs !== undefined) {
          if (!isNumber(raw.timeoutMs))
            throw stepErr(index, "expect-set.timeoutMs must be a number");
          if (raw.timeoutMs < 0) throw stepErr(index, "expect-set.timeoutMs must be >= 0");
          if (raw.timeoutMs > MAX_WAIT_MS)
            throw stepErr(index, `expect-set.timeoutMs must be <= ${MAX_WAIT_MS} (15 min)`);
          timeoutMs = raw.timeoutMs;
        }
        out.push({
          kind: "expect-set",
          ...(identifierPrefix ? { identifierPrefix } : {}),
          ...(scope ? { scope } : {}),
          labels,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "expect-screen": {
        if (!isString(raw.screenId) || !raw.screenId.trim()) {
          throw stepErr(index, "expect-screen.screenId is required");
        }
        if (!isString(raw.screenTitle) || !raw.screenTitle.trim()) {
          throw stepErr(index, "expect-screen.screenTitle is required");
        }
        if (!isString(raw.fingerprint) || !/^[a-f0-9]{64}$/u.test(raw.fingerprint)) {
          throw stepErr(index, "expect-screen.fingerprint must be a SHA-256 fingerprint");
        }
        if (
          raw.expectedApp !== undefined &&
          (!isString(raw.expectedApp) || !raw.expectedApp.trim())
        ) {
          throw stepErr(index, "expect-screen.expectedApp must be a non-empty package identifier");
        }
        if (
          raw.aliases !== undefined &&
          (!Array.isArray(raw.aliases) ||
            raw.aliases.length > 256 ||
            !raw.aliases.every((alias) => isString(alias) && /^[a-f0-9]{64}$/u.test(alias)))
        ) {
          throw stepErr(index, "expect-screen.aliases must be SHA-256 fingerprints");
        }
        let screenTimeoutMs: number | undefined;
        if (raw.timeoutMs !== undefined) {
          if (
            !isNumber(raw.timeoutMs) ||
            !Number.isInteger(raw.timeoutMs) ||
            raw.timeoutMs < 0 ||
            raw.timeoutMs > MAX_WAIT_MS
          ) {
            throw stepErr(index, `expect-screen.timeoutMs must be an integer <= ${MAX_WAIT_MS}`);
          }
          screenTimeoutMs = raw.timeoutMs;
        }
        if (
          raw.observations !== undefined &&
          (!Array.isArray(raw.observations) ||
            raw.observations.length > 256 ||
            !raw.observations.every(
              (observation) =>
                isObject(observation) &&
                isString(observation.fingerprint) &&
                /^[a-f0-9]{64}$/u.test(observation.fingerprint) &&
                Array.isArray(observation.nodes) &&
                Array.isArray(observation.volatileSignals),
            ))
        ) {
          throw stepErr(index, "expect-screen.observations must be semantic observations");
        }
        let recovery: Extract<RecipeStep, { kind: "expect-screen" }>["recovery"];
        if (raw.recovery !== undefined) {
          if (!isObject(raw.recovery) || raw.recovery.strategy !== "back") {
            throw stepErr(index, 'expect-screen.recovery.strategy must be "back"');
          }
          if (
            raw.recovery.maxAttempts !== undefined &&
            (!isNumber(raw.recovery.maxAttempts) ||
              !Number.isInteger(raw.recovery.maxAttempts) ||
              raw.recovery.maxAttempts < 1 ||
              raw.recovery.maxAttempts > 12)
          ) {
            throw stepErr(
              index,
              "expect-screen.recovery.maxAttempts must be an integer from 1 to 12",
            );
          }
          if (
            raw.recovery.restoreParentViewport !== undefined &&
            typeof raw.recovery.restoreParentViewport !== "boolean"
          ) {
            throw stepErr(index, "expect-screen.recovery.restoreParentViewport must be a boolean");
          }
          recovery = {
            strategy: "back",
            ...(raw.recovery.maxAttempts !== undefined
              ? { maxAttempts: raw.recovery.maxAttempts }
              : {}),
            ...(raw.recovery.restoreParentViewport === true ? { restoreParentViewport: true } : {}),
          };
        }
        out.push({
          kind: "expect-screen",
          screenId: raw.screenId,
          screenTitle: raw.screenTitle,
          fingerprint: raw.fingerprint,
          ...(isString(raw.expectedApp) ? { expectedApp: raw.expectedApp.trim() } : {}),
          ...(screenTimeoutMs !== undefined ? { timeoutMs: screenTimeoutMs } : {}),
          ...(raw.aliases?.length ? { aliases: [...raw.aliases] as string[] } : {}),
          ...(raw.observations?.length
            ? {
                observations: structuredClone(raw.observations) as Extract<
                  RecipeStep,
                  { kind: "expect-screen" }
                >["observations"],
              }
            : {}),
          ...(recovery ? { recovery } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "extract": {
        if (!isString(raw.as) || !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(raw.as)) {
          throw stepErr(index, "extract.as must be a valid variable name");
        }
        const target = parseTarget(raw.target, index, "target");
        if (!target.identifier && !target.ref && !target.label && !target.text) {
          throw stepErr(index, "extract target requires identifier/ref/label/text");
        }
        if (
          raw.role !== undefined &&
          raw.role !== "user" &&
          raw.role !== "assistant" &&
          raw.role !== "system"
        ) {
          throw stepErr(index, 'extract.role must be "user" | "assistant" | "system"');
        }
        out.push({
          kind: "extract",
          as: raw.as,
          target,
          ...(raw.role ? { role: raw.role } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "assert-content": {
        if (!isString(raw.input) || !raw.input.trim())
          throw stepErr(index, "assert-content.input is required");
        if (!isString(raw.expected))
          throw stepErr(index, "assert-content.expected must be a string");
        if (!["exact", "contains", "not-contains"].includes(String(raw.match))) {
          throw stepErr(
            index,
            'assert-content.match must be "exact" | "contains" | "not-contains"',
          );
        }
        out.push({
          kind: "assert-content",
          input: raw.input,
          expected: raw.expected,
          match: raw.match as "exact" | "contains" | "not-contains",
          ...(note ? { note } : {}),
        });
        break;
      }
      case "evaluate-semantic": {
        if (!isString(raw.input) || !raw.input.trim())
          throw stepErr(index, "evaluate-semantic.input is required");
        if (
          !Array.isArray(raw.criteria) ||
          raw.criteria.length === 0 ||
          !raw.criteria.every(isString)
        ) {
          throw stepErr(index, "evaluate-semantic.criteria must be a non-empty string array");
        }
        if (
          raw.threshold !== undefined &&
          (!isNumber(raw.threshold) || raw.threshold < 0 || raw.threshold > 1)
        ) {
          throw stepErr(index, "evaluate-semantic.threshold must be between 0 and 1");
        }
        if (raw.provider !== undefined && !isString(raw.provider))
          throw stepErr(index, "evaluate-semantic.provider must be a string");
        if (raw.model !== undefined && !isString(raw.model))
          throw stepErr(index, "evaluate-semantic.model must be a string");
        if (raw.requireAgreement !== undefined && typeof raw.requireAgreement !== "boolean")
          throw stepErr(index, "evaluate-semantic.requireAgreement must be a boolean");
        if (raw.secondProvider !== undefined && !isString(raw.secondProvider))
          throw stepErr(index, "evaluate-semantic.secondProvider must be a string");
        if (raw.secondModel !== undefined && !isString(raw.secondModel))
          throw stepErr(index, "evaluate-semantic.secondModel must be a string");
        if (
          raw.requireAgreement === true &&
          (!isString(raw.secondProvider) || !raw.secondProvider.trim())
        )
          throw stepErr(index, "evaluate-semantic.secondProvider is required for agreement");
        out.push({
          kind: "evaluate-semantic",
          input: raw.input,
          criteria: raw.criteria,
          ...(raw.threshold !== undefined ? { threshold: raw.threshold } : {}),
          ...(isString(raw.provider) ? { provider: raw.provider } : {}),
          ...(isString(raw.model) ? { model: raw.model } : {}),
          ...(raw.requireAgreement === true ? { requireAgreement: true } : {}),
          ...(isString(raw.secondProvider) ? { secondProvider: raw.secondProvider } : {}),
          ...(isString(raw.secondModel) ? { secondModel: raw.secondModel } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "pause": {
        if (!isString(raw.message)) throw stepErr(index, "pause requires message: string");
        const reasons: HumanCheckpointReason[] = [
          "authentication",
          "consent",
          "verification",
          "captcha",
          "permission",
          "review",
          "other",
        ];
        if (raw.reason !== undefined && !reasons.includes(raw.reason as HumanCheckpointReason)) {
          throw stepErr(index, "pause.reason is invalid");
        }
        if (raw.resumeLabel !== undefined && !isString(raw.resumeLabel)) {
          throw stepErr(index, "pause.resumeLabel must be a string");
        }
        if (
          raw.timeoutMs !== undefined &&
          (!isNumber(raw.timeoutMs) ||
            !Number.isInteger(raw.timeoutMs) ||
            raw.timeoutMs < 1_000 ||
            raw.timeoutMs > 86_400_000)
        ) {
          throw stepErr(index, "pause.timeoutMs must be an integer from 1000 to 86400000");
        }
        let verifyAfter: Extract<RecipeStep, { kind: "pause" }>["verifyAfter"];
        if (raw.verifyAfter !== undefined) {
          if (!isObject(raw.verifyAfter)) {
            throw stepErr(index, "pause.verifyAfter must be an object");
          }
          const target = parseTarget(raw.verifyAfter.target, index, "pause.verifyAfter.target");
          if (!target.identifier && !target.ref && !target.label && !target.text) {
            throw stepErr(
              index,
              "pause.verifyAfter.target must have identifier, ref, label, or text",
            );
          }
          if (
            raw.verifyAfter.condition !== undefined &&
            raw.verifyAfter.condition !== "visible" &&
            raw.verifyAfter.condition !== "gone"
          ) {
            throw stepErr(index, 'pause.verifyAfter.condition must be "visible" or "gone"');
          }
          if (
            raw.verifyAfter.timeoutMs !== undefined &&
            (!isNumber(raw.verifyAfter.timeoutMs) ||
              !Number.isInteger(raw.verifyAfter.timeoutMs) ||
              raw.verifyAfter.timeoutMs < 1_000 ||
              raw.verifyAfter.timeoutMs > 900_000)
          ) {
            throw stepErr(
              index,
              "pause.verifyAfter.timeoutMs must be an integer from 1000 to 900000",
            );
          }
          verifyAfter = {
            target,
            ...(raw.verifyAfter.condition === "gone" ? { condition: "gone" as const } : {}),
            ...(isNumber(raw.verifyAfter.timeoutMs)
              ? { timeoutMs: raw.verifyAfter.timeoutMs }
              : {}),
          };
        }
        const step: Extract<RecipeStep, { kind: "pause" }> = {
          kind: "pause",
          message: raw.message,
          ...(reasons.includes(raw.reason as HumanCheckpointReason)
            ? { reason: raw.reason as HumanCheckpointReason }
            : {}),
          ...(isString(raw.resumeLabel) && raw.resumeLabel.trim()
            ? { resumeLabel: raw.resumeLabel.trim() }
            : {}),
          ...(isNumber(raw.timeoutMs) ? { timeoutMs: raw.timeoutMs } : {}),
          ...(verifyAfter ? { verifyAfter } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "screenshot": {
        const step: Extract<RecipeStep, { kind: "screenshot" }> = {
          kind: "screenshot",
          ...(raw.caption !== undefined && isString(raw.caption) ? { caption: raw.caption } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "capture-surface": {
        if (
          !isString(raw.screenId) ||
          !raw.screenId.trim() ||
          !isString(raw.screenTitle) ||
          !raw.screenTitle.trim() ||
          !isString(raw.variantId) ||
          !raw.variantId.trim() ||
          !isString(raw.surfaceId) ||
          !raw.surfaceId.trim() ||
          !isString(raw.baselineCaptureId) ||
          !raw.baselineCaptureId.trim() ||
          !isString(raw.reason) ||
          !raw.reason.trim()
        ) {
          throw stepErr(
            index,
            "capture-surface requires screen, variant, surface, baseline, and reason",
          );
        }
        if (
          raw.maxScrolls !== undefined &&
          (!isNumber(raw.maxScrolls) ||
            !Number.isInteger(raw.maxScrolls) ||
            raw.maxScrolls < 1 ||
            raw.maxScrolls > 6)
        ) {
          throw stepErr(index, "capture-surface.maxScrolls must be an integer from 1 to 6");
        }
        const baseline =
          raw.baseline && typeof raw.baseline === "object" && !Array.isArray(raw.baseline)
            ? (raw.baseline as Record<string, unknown>)
            : undefined;
        const step: Extract<RecipeStep, { kind: "capture-surface" }> = {
          kind: "capture-surface",
          screenId: raw.screenId.trim(),
          screenTitle: raw.screenTitle.trim(),
          variantId: raw.variantId.trim(),
          surfaceId: raw.surfaceId.trim(),
          baselineCaptureId: raw.baselineCaptureId.trim(),
          reason: raw.reason.trim(),
          ...(isNumber(raw.maxScrolls) ? { maxScrolls: raw.maxScrolls } : {}),
          ...(baseline && isNumber(baseline.semanticNodeCount)
            ? {
                baseline: {
                  ...(isNumber(baseline.compositeWidth)
                    ? { compositeWidth: baseline.compositeWidth }
                    : {}),
                  ...(isNumber(baseline.compositeHeight)
                    ? { compositeHeight: baseline.compositeHeight }
                    : {}),
                  semanticNodeCount: baseline.semanticNodeCount,
                },
              }
            : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "tour": {
        if (raw.depth !== undefined && (!isNumber(raw.depth) || raw.depth < 0 || raw.depth > 3)) {
          throw stepErr(index, "tour.depth must be 0–3");
        }
        if (raw.maxStops !== undefined && (!isNumber(raw.maxStops) || raw.maxStops < 1)) {
          throw stepErr(index, "tour.maxStops must be a positive number");
        }
        const parseTourStops = (value: unknown, includeCapture: boolean) =>
          Array.isArray(value)
            ? value.flatMap((item) => {
                if (!item || typeof item !== "object") return [];
                const row = item as {
                  label?: unknown;
                  identifier?: unknown;
                  point?: { x?: unknown; y?: unknown };
                  capture?: unknown;
                  optional?: unknown;
                };
                const label = typeof row.label === "string" ? row.label.trim() : "";
                if (!label) return [];
                const identifier = typeof row.identifier === "string" ? row.identifier.trim() : "";
                const point =
                  row.point && isNumber(row.point.x) && isNumber(row.point.y)
                    ? { x: row.point.x, y: row.point.y }
                    : undefined;
                return [
                  {
                    label,
                    ...(identifier ? { identifier } : {}),
                    ...(point ? { point } : {}),
                    ...(includeCapture && row.capture === true ? { capture: true } : {}),
                    ...(includeCapture && row.optional === true ? { optional: true } : {}),
                  },
                ];
              })
            : [];
        const fallbackStops = parseTourStops(raw.fallbackStops, true);
        const landmarkStops = parseTourStops(raw.landmarkStops, false);
        const originScreenId =
          isString(raw.originScreenId) && raw.originScreenId.trim()
            ? raw.originScreenId.trim()
            : undefined;
        const originTitle =
          isString(raw.originTitle) && raw.originTitle.trim() ? raw.originTitle.trim() : undefined;
        if (
          raw.originFingerprint !== undefined &&
          (!isString(raw.originFingerprint) || !/^[a-f0-9]{64}$/u.test(raw.originFingerprint))
        ) {
          throw stepErr(index, "tour.originFingerprint must be a SHA-256 fingerprint");
        }
        if (
          raw.originAliases !== undefined &&
          (!Array.isArray(raw.originAliases) ||
            raw.originAliases.length > 256 ||
            !raw.originAliases.every((alias) => isString(alias) && /^[a-f0-9]{64}$/u.test(alias)))
        ) {
          throw stepErr(index, "tour.originAliases must be SHA-256 fingerprints");
        }
        if (
          raw.originObservations !== undefined &&
          (!Array.isArray(raw.originObservations) ||
            raw.originObservations.length > 256 ||
            !raw.originObservations.every(
              (observation) =>
                isObject(observation) &&
                isString(observation.fingerprint) &&
                /^[a-f0-9]{64}$/u.test(observation.fingerprint) &&
                Array.isArray(observation.nodes) &&
                Array.isArray(observation.volatileSignals),
            ))
        ) {
          throw stepErr(index, "tour.originObservations must be semantic observations");
        }
        if (
          raw.preludeStartFingerprint !== undefined &&
          (!isString(raw.preludeStartFingerprint) ||
            !/^[a-f0-9]{64}$/u.test(raw.preludeStartFingerprint))
        ) {
          throw stepErr(index, "tour.preludeStartFingerprint must be a SHA-256 fingerprint");
        }
        if (
          raw.preludeStartAliases !== undefined &&
          (!Array.isArray(raw.preludeStartAliases) ||
            raw.preludeStartAliases.length > 256 ||
            !raw.preludeStartAliases.every(
              (alias) => isString(alias) && /^[a-f0-9]{64}$/u.test(alias),
            ))
        ) {
          throw stepErr(index, "tour.preludeStartAliases must be SHA-256 fingerprints");
        }
        let preludeSteps:
          | Extract<RecipeStep, { kind: "tap" | "key" | "swipe" | "scroll" }>[]
          | undefined;
        if (raw.preludeSteps !== undefined) {
          if (!Array.isArray(raw.preludeSteps) || raw.preludeSteps.length > 16) {
            throw stepErr(index, "tour.preludeSteps must contain at most 16 steps");
          }
          const parsed = validateRecipeSteps(raw.preludeSteps);
          for (const [offset, item] of parsed.entries()) {
            if (
              item.kind !== "tap" &&
              item.kind !== "key" &&
              item.kind !== "swipe" &&
              item.kind !== "scroll"
            ) {
              throw stepErr(
                index,
                `tour.preludeSteps[${offset}] must be tap, key, swipe, or scroll`,
              );
            }
          }
          preludeSteps = parsed as Extract<
            RecipeStep,
            { kind: "tap" | "key" | "swipe" | "scroll" }
          >[];
        }
        const tourRuntimeOptions = parseTourRuntimeOptions(raw, index);
        const step: Extract<RecipeStep, { kind: "tour" }> = {
          kind: "tour",
          ...(isNumber(raw.depth) ? { depth: raw.depth } : {}),
          ...(raw.screenshot === false ? { screenshot: false } : {}),
          ...(raw.screenshot === true ? { screenshot: true } : {}),
          ...(raw.captureOrigin === true ? { captureOrigin: true } : {}),
          ...(raw.originVerifiedBySetup === true ? { originVerifiedBySetup: true } : {}),
          ...(isNumber(raw.maxStops) ? { maxStops: raw.maxStops } : {}),
          ...(raw.excludeLanguageRows === true ? { excludeLanguageRows: true } : {}),
          ...(originScreenId ? { originScreenId } : {}),
          ...(originTitle ? { originTitle } : {}),
          ...(isString(raw.originFingerprint) ? { originFingerprint: raw.originFingerprint } : {}),
          ...(Array.isArray(raw.originAliases) && raw.originAliases.length
            ? { originAliases: raw.originAliases }
            : {}),
          ...(raw.originObservations?.length
            ? {
                originObservations: structuredClone(raw.originObservations) as Extract<
                  RecipeStep,
                  { kind: "tour" }
                >["originObservations"],
              }
            : {}),
          ...(isString(raw.preludeStartFingerprint)
            ? { preludeStartFingerprint: raw.preludeStartFingerprint }
            : {}),
          ...(Array.isArray(raw.preludeStartAliases) && raw.preludeStartAliases.length
            ? { preludeStartAliases: raw.preludeStartAliases }
            : {}),
          ...(preludeSteps?.length ? { preludeSteps } : {}),
          ...(fallbackStops.length ? { fallbackStops } : {}),
          ...(landmarkStops.length ? { landmarkStops } : {}),
          ...tourRuntimeOptions,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "review": {
        if (!isString(raw.capability) || !raw.capability.trim()) {
          throw stepErr(index, "review.capability is required");
        }
        if (!isString(raw.reason) || !raw.reason.trim()) {
          throw stepErr(index, "review.reason is required");
        }
        if (raw.capability.trim().length > 120) {
          throw stepErr(index, "review.capability must be 120 characters or fewer");
        }
        if (raw.reason.trim().length > 500) {
          throw stepErr(index, "review.reason must be 500 characters or fewer");
        }
        out.push({
          kind: "review",
          capability: raw.capability.trim(),
          reason: raw.reason.trim(),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "flow": {
        if (!isString(raw.flow)) throw stepErr(index, "flow requires flow: string (an ActionId)");
        if (!isActionId(raw.flow)) {
          throw stepErr(index, `flow references unknown action id: ${raw.flow}`);
        }
        const step: Extract<RecipeStep, { kind: "flow" }> = {
          kind: "flow",
          flow: raw.flow,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "module": {
        if (!isString(raw.recipeId) || !raw.recipeId.trim())
          throw stepErr(index, "module requires recipeId: string");
        let bindings: Record<string, string> | undefined;
        if (raw.bindings !== undefined) {
          if (!isObject(raw.bindings)) throw stepErr(index, "module.bindings must be a mapping");
          bindings = {};
          for (const [name, value] of Object.entries(raw.bindings)) {
            if (!PARAMETER_NAME.test(name))
              throw stepErr(index, `module.bindings.${name} is invalid`);
            if (!isString(value)) throw stepErr(index, `module.bindings.${name} must be a string`);
            bindings[name] = value;
          }
        }
        out.push({
          kind: "module",
          recipeId: raw.recipeId,
          ...(bindings && Object.keys(bindings).length ? { bindings } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "branch": {
        if (!isString(raw.input) || !raw.input.trim())
          throw stepErr(index, "branch.input is required");
        if (!["exists", "equals", "not-equals", "contains"].includes(String(raw.operator)))
          throw stepErr(index, "branch.operator is invalid");
        if (!isString(raw.thenRecipeId) || !raw.thenRecipeId.trim())
          throw stepErr(index, "branch.thenRecipeId is required");
        if (raw.elseRecipeId !== undefined && !isString(raw.elseRecipeId))
          throw stepErr(index, "branch.elseRecipeId must be a string");
        if (raw.operator !== "exists" && !isString(raw.expected))
          throw stepErr(index, "branch.expected is required for this operator");
        out.push({
          kind: "branch",
          input: raw.input,
          operator: raw.operator as "exists" | "equals" | "not-equals" | "contains",
          ...(isString(raw.expected) ? { expected: raw.expected } : {}),
          thenRecipeId: raw.thenRecipeId,
          ...(isString(raw.elseRecipeId) && raw.elseRecipeId.trim()
            ? { elseRecipeId: raw.elseRecipeId }
            : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "repeat": {
        if (!isNumber(raw.count) || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > 20)
          throw stepErr(index, "repeat.count must be an integer from 1 to 20");
        if (!isString(raw.recipeId) || !raw.recipeId.trim())
          throw stepErr(index, "repeat.recipeId is required");
        out.push({
          kind: "repeat",
          count: raw.count,
          recipeId: raw.recipeId,
          ...(note ? { note } : {}),
        });
        break;
      }
      case "script": {
        if (!isString(raw.source) || !raw.source.trim())
          throw stepErr(index, "script.source is required");
        if (raw.source.length > 20_000) throw stepErr(index, "script.source is too large");
        out.push({ kind: "script", source: raw.source, ...(note ? { note } : {}) });
        break;
      }
      case "clipboard": {
        if (!["read", "write", "paste", "copy"].includes(String(raw.action)))
          throw stepErr(index, 'clipboard requires action: "read" | "write" | "paste" | "copy"');
        if (raw.action === "write" && !isString(raw.text))
          throw stepErr(index, "clipboard write requires text: string");
        const target =
          raw.action === "paste" || raw.action === "copy"
            ? parseTarget(raw.target, index, "target")
            : undefined;
        if (target && !target.identifier && !target.label && !target.text)
          throw stepErr(
            index,
            `clipboard ${raw.action} target requires identifier, label, or text`,
          );
        if (raw.expect !== undefined && !isString(raw.expect))
          throw stepErr(index, "clipboard.expect must be a string");
        if (raw.match !== undefined && raw.match !== "exact" && raw.match !== "contains")
          throw stepErr(index, 'clipboard.match must be "exact" | "contains"');
        out.push({
          kind: "clipboard",
          action: raw.action as "read" | "write" | "paste" | "copy",
          ...(isString(raw.text) ? { text: raw.text } : {}),
          ...(target ? { target } : {}),
          ...(isString(raw.expect) ? { expect: raw.expect } : {}),
          ...(raw.match === "contains" || raw.match === "exact" ? { match: raw.match } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "app": {
        const actions = [
          "open",
          "close",
          "switcher",
          "inspect",
          "assert-installed",
          "assert-not-installed",
          "set-locale",
          "install",
          "update",
          "uninstall",
        ] as const;
        if (!actions.includes(raw.action as (typeof actions)[number]))
          throw stepErr(index, "app has an invalid action");
        if (raw.app !== undefined && !isString(raw.app))
          throw stepErr(index, "app.app must be a string");
        if (raw.locale !== undefined && !isString(raw.locale))
          throw stepErr(index, "app.locale must be a string");
        if (raw.url !== undefined && !isString(raw.url))
          throw stepErr(index, "app.url must be a string");
        if (raw.artifact !== undefined && !isString(raw.artifact))
          throw stepErr(index, "app.artifact must be a string");
        if (
          raw.as !== undefined &&
          (!isString(raw.as) || !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(raw.as))
        )
          throw stepErr(index, "app.as must be a valid variable name");
        if (raw.version !== undefined && !isString(raw.version))
          throw stepErr(index, "app.version must be a string");
        if (
          raw.versionMatch !== undefined &&
          raw.versionMatch !== "exact" &&
          raw.versionMatch !== "contains"
        )
          throw stepErr(index, 'app.versionMatch must be "exact" | "contains"');
        if (raw.action === "open" && !isString(raw.app) && !isString(raw.url))
          throw stepErr(index, "app open requires app or url");
        if (raw.relaunch !== undefined && typeof raw.relaunch !== "boolean")
          throw stepErr(index, "app relaunch must be a boolean");
        if (
          raw.action !== "open" &&
          raw.action !== "switcher" &&
          (!isString(raw.app) || !raw.app.trim())
        ) {
          throw stepErr(index, `${raw.action} requires app package or bundle identifier`);
        }
        if (raw.action === "set-locale" && (!isString(raw.locale) || !raw.locale.trim())) {
          throw stepErr(index, "set-locale requires a BCP-47 locale");
        }
        if (
          (raw.action === "install" || raw.action === "update") &&
          (!isString(raw.artifact) || !raw.artifact.trim())
        ) {
          throw stepErr(index, `${raw.action} requires a local APK artifact path`);
        }
        if (raw.action === "assert-not-installed" && raw.version !== undefined) {
          throw stepErr(index, "assert-not-installed cannot include a version");
        }
        out.push({
          kind: "app",
          action: raw.action as Extract<RecipeStep, { kind: "app" }>["action"],
          ...(isString(raw.app) ? { app: raw.app } : {}),
          ...(isString(raw.locale) ? { locale: raw.locale } : {}),
          ...(isString(raw.url) ? { url: raw.url } : {}),
          ...(typeof raw.relaunch === "boolean" ? { relaunch: raw.relaunch } : {}),
          ...(isString(raw.artifact) ? { artifact: raw.artifact } : {}),
          ...(isString(raw.as) ? { as: raw.as } : {}),
          ...(isString(raw.version) ? { version: raw.version } : {}),
          ...(raw.versionMatch === "exact" || raw.versionMatch === "contains"
            ? { versionMatch: raw.versionMatch }
            : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "device": {
        if (!["lock", "unlock", "keyboard-dismiss", "keyboard-enter"].includes(String(raw.action)))
          throw stepErr(index, "device has an unknown action");
        out.push({
          kind: "device",
          action: raw.action as "lock" | "unlock" | "keyboard-dismiss" | "keyboard-enter",
          ...(note ? { note } : {}),
        });
        break;
      }
      case "rotate": {
        if (
          !["portrait", "portrait-upside-down", "landscape-left", "landscape-right"].includes(
            String(raw.orientation),
          )
        )
          throw stepErr(index, "rotate has an invalid orientation");
        out.push({
          kind: "rotate",
          orientation: raw.orientation as
            | "portrait"
            | "portrait-upside-down"
            | "landscape-left"
            | "landscape-right",
          ...(note ? { note } : {}),
        });
        break;
      }
      case "settings": {
        if (
          !["wifi", "airplane", "location", "animations", "appearance"].includes(
            String(raw.setting),
          )
        )
          throw stepErr(index, "settings has an invalid setting");
        if (!["on", "off", "light", "dark", "toggle"].includes(String(raw.state)))
          throw stepErr(index, "settings has an invalid state");
        if (
          raw.setting === "appearance"
            ? !["light", "dark", "toggle"].includes(String(raw.state))
            : !["on", "off"].includes(String(raw.state))
        )
          throw stepErr(index, "settings state is not valid for this setting");
        out.push({
          kind: "settings",
          setting: raw.setting as "wifi" | "airplane" | "location" | "animations" | "appearance",
          state: raw.state as "on" | "off" | "light" | "dark" | "toggle",
          ...(note ? { note } : {}),
        });
        break;
      }
      case "location": {
        if (!isNumber(raw.latitude) || !isNumber(raw.longitude))
          throw stepErr(index, "location requires latitude and longitude numbers");
        if (raw.latitude < -90 || raw.latitude > 90 || raw.longitude < -180 || raw.longitude > 180)
          throw stepErr(index, "location coordinates are out of range");
        out.push({
          kind: "location",
          latitude: raw.latitude,
          longitude: raw.longitude,
          ...(note ? { note } : {}),
        });
        break;
      }
      case "permission": {
        const permissions = [
          "camera",
          "microphone",
          "photos",
          "contacts",
          "notifications",
          "calendar",
          "location",
          "location-always",
          "media-library",
          "motion",
          "reminders",
          "siri",
        ] as const;
        if (!["grant", "deny", "reset"].includes(String(raw.action)))
          throw stepErr(index, "permission has an invalid action");
        if (!permissions.includes(raw.permission as (typeof permissions)[number]))
          throw stepErr(index, "permission has an invalid target");
        out.push({
          kind: "permission",
          action: raw.action as "grant" | "deny" | "reset",
          permission: raw.permission as (typeof permissions)[number],
          ...(note ? { note } : {}),
        });
        break;
      }
      case "alert": {
        if (!["get", "accept", "dismiss", "wait"].includes(String(raw.action)))
          throw stepErr(index, "alert has an invalid action");
        if (
          raw.timeoutMs !== undefined &&
          (!isNumber(raw.timeoutMs) || raw.timeoutMs < 0 || raw.timeoutMs > MAX_WAIT_MS)
        )
          throw stepErr(index, "alert.timeoutMs is invalid");
        out.push({
          kind: "alert",
          action: raw.action as "get" | "accept" | "dismiss" | "wait",
          ...(isNumber(raw.timeoutMs) ? { timeoutMs: raw.timeoutMs } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "network": {
        if (raw.action !== "dump" && raw.action !== "log")
          throw stepErr(index, 'network requires action: "dump" | "log"');
        if (
          raw.include !== undefined &&
          !["summary", "headers", "body", "all"].includes(String(raw.include))
        )
          throw stepErr(index, "network.include is invalid");
        if (raw.limit !== undefined && (!isNumber(raw.limit) || raw.limit < 1 || raw.limit > 1000))
          throw stepErr(index, "network.limit must be between 1 and 1000");
        out.push({
          kind: "network",
          action: raw.action,
          ...(raw.include
            ? { include: raw.include as "summary" | "headers" | "body" | "all" }
            : {}),
          ...(isNumber(raw.limit) ? { limit: raw.limit } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "logs": {
        if (!["start", "stop", "mark", "clear"].includes(String(raw.action)))
          throw stepErr(index, "logs has an invalid action");
        if (raw.message !== undefined && !isString(raw.message))
          throw stepErr(index, "logs.message must be a string");
        out.push({
          kind: "logs",
          action: raw.action as "start" | "stop" | "mark" | "clear",
          ...(isString(raw.message) ? { message: raw.message } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      default:
        throw stepErr(index, `unknown step kind: ${kind}`);
    }
  });
  return out.map((step, position) => ({
    ...step,
    ...parseStepMetadata(steps[position] as Record<string, unknown>, position + 1),
  }));
}
