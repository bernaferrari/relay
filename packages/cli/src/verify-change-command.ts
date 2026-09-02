import { execFile } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import {
  CHANGE_SIGNAL_KINDS,
  VERIFY_CHANGE_POLICY,
  changeVerificationChangeSchema,
  changeVerificationPolicySchema,
  changeRefSchema,
  journeyAssociationSchema,
  proofBuildDefinitionSchema,
  verificationCellSchema,
  verificationPlanSchema,
} from "@relay/protocol";
import { compileVerificationPlan, proofStartInputFromVerificationPlan } from "@relay/core";
import { invokeOperation } from "./invoke.js";
import { UsageError } from "./errors.js";
import {
  assertExecutablePlanTargets,
  executeVerifyChangeLive,
  isExecutableVerificationPlan,
  nextVerifyChangeAction,
  proofRecord,
} from "./verify-change-live.js";
import {
  boundedInteger,
  boundedText,
  configError,
  record,
  verifyChangeRequestIdentity,
} from "./verify-change-utils.js";
import {
  VERIFY_CHANGE_MAX_ASSOCIATIONS,
  VERIFY_CHANGE_MAX_CHANGED_FILES,
  VERIFY_CHANGE_MAX_CONFIG_BYTES,
  VERIFY_CHANGE_MAX_GIT_OUTPUT_BYTES,
  type VerifyChangeCommandInput,
  type VerifyChangeGitRunner,
  type VerifyChangeNextAction,
  type VerifyChangePlanResult,
} from "./verify-change-types.js";

export {
  VERIFY_CHANGE_MAX_ASSOCIATIONS,
  VERIFY_CHANGE_MAX_CHANGED_FILES,
  VERIFY_CHANGE_MAX_CONFIG_BYTES,
  VERIFY_CHANGE_MAX_GIT_OUTPUT_BYTES,
  VERIFY_CHANGE_MAX_POLL_ATTEMPTS,
  type VerifyChangeActorKind,
  type VerifyChangeCommandInput,
  type VerifyChangeConfigReader,
  type VerifyChangeGitResult,
  type VerifyChangeGitRunner,
  type VerifyChangeJobPoller,
  type VerifyChangeNextAction,
  type VerifyChangePlanResult,
  type VerifyChangeSleep,
} from "./verify-change-types.js";

export {
  VERIFY_CHANGE_DEFAULT_POLL_INTERVAL_MS,
  VERIFY_CHANGE_DEFAULT_POLL_TIMEOUT_MS,
  VERIFY_CHANGE_MAX_POLL_TIMEOUT_MS,
} from "./verify-change-types.js";

const execFileAsync = promisify(execFile);

type SignalKind = (typeof CHANGE_SIGNAL_KINDS)[number];
type SignalPatch = Partial<Record<SignalKind, readonly string[]>>;

type ReviewedChangeProofConfig = {
  repository: string;
  changeRef?: ReturnType<typeof changeRefSchema.parse>;
  pullRequest?: number;
  agentClaim?: unknown;
  changed: SignalPatch;
  associations: readonly unknown[];
  buildDefinitions: readonly ReturnType<typeof proofBuildDefinitionSchema.parse>[];
  builds: readonly unknown[];
  targetCases: readonly unknown[];
  cells?: readonly ReturnType<typeof verificationCellSchema.parse>[];
  pilotCellId?: string;
  policy: unknown;
  maxCases?: number;
  maxDurationMs?: number;
};

function parseSignalPatch(value: unknown): SignalPatch {
  if (value === undefined) return {};
  const input = record(value, "change-proof.json changed");
  const allowed = new Set<string>(CHANGE_SIGNAL_KINDS);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new UsageError(`change-proof.json changed has unknown field ${key}`);
    }
  }
  const patch: Partial<Record<SignalKind, string[]>> = {};
  for (const kind of CHANGE_SIGNAL_KINDS) {
    const values = input[kind];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.length > 2_048) {
      throw new UsageError(
        `change-proof.json changed.${kind} must be an array of at most 2048 strings`,
      );
    }
    patch[kind] = values.map((item, index) =>
      boundedText(item, `change-proof.json changed.${kind}[${index}]`, 1_024),
    );
  }
  return patch;
}

function parseReviewedConfig(value: unknown): ReviewedChangeProofConfig {
  const input = record(value, "change-proof.json");
  const allowed = new Set([
    "schemaVersion",
    "repository",
    "changeRef",
    "pullRequest",
    "agentClaim",
    "changed",
    "associations",
    "buildDefinitions",
    "builds",
    "targetCases",
    "cells",
    "pilotCellId",
    "policy",
    "maxCases",
    "maxDurationMs",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new UsageError(`change-proof.json has unknown field ${key}`);
  }
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) {
    throw new UsageError("change-proof.json schemaVersion must be 1");
  }

  const repository = boundedText(input.repository, "change-proof.json repository", 512);
  let changeRef: ReviewedChangeProofConfig["changeRef"];
  if (input.changeRef !== undefined) {
    try {
      changeRef = changeRefSchema.parse(input.changeRef);
    } catch (error) {
      throw configError("change-proof.json changeRef", error);
    }
  }
  const pullRequest =
    input.pullRequest === undefined
      ? undefined
      : boundedInteger(input.pullRequest, "change-proof.json pullRequest", 2_147_483_647);
  const associationsValue = input.associations ?? [];
  if (
    !Array.isArray(associationsValue) ||
    associationsValue.length > VERIFY_CHANGE_MAX_ASSOCIATIONS
  ) {
    throw new UsageError(
      `change-proof.json associations must be an array of at most ${VERIFY_CHANGE_MAX_ASSOCIATIONS} entries`,
    );
  }
  const associations = associationsValue.map((association, index) => {
    try {
      return journeyAssociationSchema.parse(association);
    } catch (error) {
      throw configError(`change-proof.json associations[${index}]`, error);
    }
  });

  const buildDefinitionsValue = input.buildDefinitions ?? [];
  if (!Array.isArray(buildDefinitionsValue) || buildDefinitionsValue.length > 32) {
    throw new UsageError(
      "change-proof.json buildDefinitions must be an array of at most 32 entries",
    );
  }
  const buildDefinitions = buildDefinitionsValue.map((definition, index) => {
    try {
      return proofBuildDefinitionSchema.parse(definition);
    } catch (error) {
      throw configError(`change-proof.json buildDefinitions[${index}]`, error);
    }
  });

  const list = (field: "builds" | "targetCases", max: number): readonly unknown[] => {
    const values = input[field] ?? [];
    if (!Array.isArray(values) || values.length > max) {
      throw new UsageError(`change-proof.json ${field} must be an array of at most ${max} entries`);
    }
    return values;
  };
  const policy = input.policy ?? VERIFY_CHANGE_POLICY;
  try {
    changeVerificationPolicySchema.parse(policy);
  } catch (error) {
    throw configError("change-proof.json policy", error);
  }

  const maxCases =
    input.maxCases === undefined
      ? undefined
      : boundedInteger(input.maxCases, "change-proof.json maxCases", 10_000);
  const maxDurationMs =
    input.maxDurationMs === undefined
      ? undefined
      : boundedInteger(input.maxDurationMs, "change-proof.json maxDurationMs", 86_400_000);
  let cells: ReviewedChangeProofConfig["cells"];
  if (input.cells !== undefined) {
    if (!Array.isArray(input.cells) || input.cells.length > 1_000) {
      throw new UsageError("change-proof.json cells must be an array of at most 1000 entries");
    }
    cells = input.cells.map((cell, index) => {
      try {
        return verificationCellSchema.parse(cell);
      } catch (error) {
        throw configError(`change-proof.json cells[${index}]`, error);
      }
    });
  }
  const pilotCellId =
    input.pilotCellId === undefined
      ? undefined
      : boundedText(input.pilotCellId, "change-proof.json pilotCellId", 256);
  return {
    repository,
    ...(changeRef ? { changeRef } : {}),
    ...(pullRequest === undefined ? {} : { pullRequest }),
    ...(input.agentClaim === undefined ? {} : { agentClaim: input.agentClaim }),
    changed: parseSignalPatch(input.changed),
    associations,
    buildDefinitions,
    builds: list("builds", 32),
    targetCases: list("targetCases", 250),
    ...(cells ? { cells } : {}),
    ...(pilotCellId ? { pilotCellId } : {}),
    policy,
    ...(maxCases === undefined ? {} : { maxCases }),
    ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
  };
}

function defaultConfigReader(path: string): unknown {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    throw new UsageError(
      `Could not read reviewed config ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!stat.isFile()) throw new UsageError(`Reviewed config ${path} is not a regular file`);
  if (stat.size > VERIFY_CHANGE_MAX_CONFIG_BYTES) {
    throw new UsageError(`Reviewed config ${path} exceeds ${VERIFY_CHANGE_MAX_CONFIG_BYTES} bytes`);
  }
  try {
    const contents = readFileSync(path, "utf8");
    if (Buffer.byteLength(contents, "utf8") > VERIFY_CHANGE_MAX_CONFIG_BYTES) {
      throw new UsageError(
        `Reviewed config ${path} exceeds ${VERIFY_CHANGE_MAX_CONFIG_BYTES} bytes`,
      );
    }
    return JSON.parse(contents) as unknown;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(
      `Reviewed config ${path} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function defaultGit(args: readonly string[], options: { cwd: string; maxBuffer: number }) {
  const result = await execFileAsync("git", [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: options.maxBuffer,
    windowsHide: true,
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

function safeGitArgument(value: string): string {
  let safe = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    safe += code <= 0x1f || code === 0x7f ? "?" : character;
  }
  return safe.slice(0, 256);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

async function git(
  runner: VerifyChangeGitRunner,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  try {
    const result = await runner(args, { cwd, maxBuffer: VERIFY_CHANGE_MAX_GIT_OUTPUT_BYTES });
    if (
      typeof result.stdout !== "string" ||
      Buffer.byteLength(result.stdout, "utf8") > VERIFY_CHANGE_MAX_GIT_OUTPUT_BYTES
    ) {
      throw new UsageError("Git returned output outside the bounded change-verification limit");
    }
    return result.stdout;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const detail =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : error instanceof Error
          ? error.message
          : String(error);
    throw new UsageError(
      `Git ${safeGitArgument(args[0] ?? "command")} failed${detail ? `: ${safeGitArgument(detail)}` : ""}`,
    );
  }
}

function exactSha(value: string, label: string): string {
  const sha = value.trim();
  if (!/^[a-f0-9]{40}$/u.test(sha)) {
    throw new UsageError(`Git ${label} did not resolve to one exact 40-character lowercase SHA`);
  }
  return sha;
}

/** Compile the reviewed Git/config inputs; confirmed executable plans enter the
 * server-owned Proof lifecycle in verify-change-live.ts. */
export async function runVerifyChangeCommand(
  input: VerifyChangeCommandInput,
): Promise<VerifyChangePlanResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const configPath = isAbsolute(input.configFile)
    ? input.configFile
    : resolve(cwd, input.configFile);
  if (configPath.includes("\0")) throw new UsageError("Reviewed config path contains NUL");
  const rawConfig = await (input.readConfig ?? defaultConfigReader)(configPath);
  if (
    typeof rawConfig === "string" &&
    Buffer.byteLength(rawConfig, "utf8") > VERIFY_CHANGE_MAX_CONFIG_BYTES
  ) {
    throw new UsageError(
      `Reviewed config ${configPath} exceeds ${VERIFY_CHANGE_MAX_CONFIG_BYTES} bytes`,
    );
  }
  const config = parseReviewedConfig(
    typeof rawConfig === "string"
      ? (() => {
          try {
            return JSON.parse(rawConfig) as unknown;
          } catch (error) {
            throw configError("change-proof.json", error);
          }
        })()
      : rawConfig,
  );
  if (config.changed.files?.length) {
    throw new UsageError(
      "change-proof.json changed.files must be empty; changed files are resolved from exact Git diff output",
    );
  }

  const baseRef = boundedText(input.base, "--base", 512);
  if (hasControlCharacters(baseRef))
    throw new UsageError("--base must not contain control characters");
  const runner = input.git ?? defaultGit;
  const repositoryRoot = (await git(runner, ["rev-parse", "--show-toplevel"], cwd)).trim();
  if (!repositoryRoot || !isAbsolute(repositoryRoot) || repositoryRoot.includes("\0")) {
    throw new UsageError("Git did not return one absolute repository root");
  }
  const baseTipSha = exactSha(
    await git(
      runner,
      ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`],
      repositoryRoot,
    ),
    "base ref",
  );
  const workspaceHeadSha = exactSha(
    await git(
      runner,
      ["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"],
      repositoryRoot,
    ),
    "HEAD",
  );
  const baseSha = exactSha(
    await git(runner, ["merge-base", "--", baseTipSha, workspaceHeadSha], repositoryRoot),
    "merge base",
  );
  const configuredChangeRef = config.changeRef;
  if (
    configuredChangeRef &&
    (configuredChangeRef.baseTipSha !== baseTipSha || configuredChangeRef.mergeBaseSha !== baseSha)
  ) {
    throw new UsageError(
      "change-proof.json changeRef must match the exact base tip and merge base resolved from Git",
    );
  }
  const requestedHeadSha = configuredChangeRef?.requestedHeadSha ?? workspaceHeadSha;
  const testedSha = configuredChangeRef?.testedSha ?? workspaceHeadSha;
  // A configured tested revision is still resolved through Git before it can
  // influence the diff or Proof. This prevents a provider payload from
  // becoming durable merely because it has a SHA-shaped string.
  if (configuredChangeRef) {
    exactSha(
      await git(
        runner,
        ["rev-parse", "--verify", "--end-of-options", `${testedSha}^{commit}`],
        repositoryRoot,
      ),
      "tested revision",
    );
  }
  const diffOutput = await git(
    runner,
    ["diff", "--name-only", "-z", "--diff-filter=ACDMRTUXB", baseSha, testedSha, "--"],
    repositoryRoot,
  );
  const changedFiles = diffOutput.split("\0").filter(Boolean).sort();
  if (changedFiles.length > VERIFY_CHANGE_MAX_CHANGED_FILES) {
    throw new UsageError(`Git change contains more than ${VERIFY_CHANGE_MAX_CHANGED_FILES} files`);
  }
  if (changedFiles.some((path) => !path || path.includes("\0"))) {
    throw new UsageError("Git returned an invalid changed-file path");
  }

  const change = changeVerificationChangeSchema.parse({
    repository: config.repository,
    baseSha,
    headSha: testedSha,
    baseTipSha: configuredChangeRef?.baseTipSha ?? baseTipSha,
    mergeBaseSha: configuredChangeRef?.mergeBaseSha ?? baseSha,
    requestedHeadSha,
    testedSha,
    testedKind: configuredChangeRef?.testedKind ?? "head",
    ...(configuredChangeRef?.previousHeadSha
      ? { previousHeadSha: configuredChangeRef.previousHeadSha }
      : {}),
    ...(configuredChangeRef?.targetBranch
      ? { targetBranch: configuredChangeRef.targetBranch }
      : {}),
    ...(configuredChangeRef?.repositoryId
      ? { repositoryId: configuredChangeRef.repositoryId }
      : { repositoryId: config.repository }),
    ...(configuredChangeRef?.provider ? { provider: configuredChangeRef.provider } : {}),
    ...(configuredChangeRef?.mergeGroupId
      ? { mergeGroupId: configuredChangeRef.mergeGroupId }
      : {}),
    ...(config.pullRequest === undefined ? {} : { pullRequest: config.pullRequest }),
    ...(config.agentClaim === undefined ? {} : { agentClaim: config.agentClaim }),
  });
  let plan = compileVerificationPlan({
    change,
    changed: {
      files: changedFiles,
      symbols: [...(config.changed.symbols ?? [])],
      routes: [...(config.changed.routes ?? [])],
      resources: [...(config.changed.resources ?? [])],
      localizationKeys: [...(config.changed.localizationKeys ?? [])],
      apiContracts: [...(config.changed.apiContracts ?? [])],
    },
    associations: config.associations,
    builds: config.builds,
    targetCases: config.targetCases,
    ...(config.cells ? { cells: config.cells } : {}),
    ...(config.pilotCellId ? { pilotCellId: config.pilotCellId } : {}),
    policy: config.policy,
    ...(config.maxCases === undefined ? {} : { maxCases: config.maxCases }),
    ...(config.maxDurationMs === undefined ? {} : { maxDurationMs: config.maxDurationMs }),
  });
  if (isExecutableVerificationPlan(plan)) assertExecutablePlanTargets(plan);

  let proofStart = proofStartInputFromVerificationPlan(plan);
  let proofStartResponse: unknown;
  let proofApprovalResponse: unknown;
  let proof: Record<string, unknown> | undefined;
  let liveRuns: VerifyChangePlanResult["execution"]["runs"] = [];
  let livePilot: VerifyChangePlanResult["execution"]["pilot"] = {
    available: false,
    attempted: false,
    reason: input.confirm
      ? "The reviewed plan is not complete and executable; no target was controlled."
      : "No durable Proof was created because --confirm was not supplied; no target or Relay mutation was attempted.",
  };
  let planApproved = false;
  let terminalState: string | undefined;
  let liveNextAction: VerifyChangeNextAction | undefined;

  if (input.confirm) {
    if (!input.client) throw new UsageError("prove --confirm requires a Relay client");
    const signal = input.signal ?? new AbortController().signal;
    const prepareInput = {
      baseRef,
      ...(config.pullRequest === undefined ? {} : { pullRequest: config.pullRequest }),
      ...(config.agentClaim === undefined ? {} : { agentClaim: config.agentClaim }),
      policy: config.policy,
      ...(plan.selection.targetCases.length
        ? {
            targetIds: plan.selection.targetCases.map(
              ({ executionTarget }) => executionTarget.targetId,
            ),
          }
        : {}),
      ...(plan.builds.length ? { buildIds: plan.builds.map(({ id }) => id) } : {}),
    };
    proofStartResponse = await invokeOperation(
      input.client,
      "proof.prepare",
      prepareInput,
      signal,
      verifyChangeRequestIdentity("proof-prepare", JSON.stringify(prepareInput)),
    );
    const prepared = record(proofStartResponse, "proof.prepare");
    plan = verificationPlanSchema.parse(prepared.plan);
    proofStart = proofStartInputFromVerificationPlan(plan);
    proof = proofRecord(prepared);
    if (!proof) throw new UsageError("proof.prepare returned no durable Proof");
    if (isExecutableVerificationPlan(plan)) {
      const live = await executeVerifyChangeLive({
        client: input.client,
        plan,
        proof,
        actorKind: input.actorKind,
        signal,
      });
      proof = live.proof;
      proofApprovalResponse = live.proofApprovalResponse;
      planApproved = live.planApproved;
      livePilot = live.pilot;
      liveRuns = live.runs;
      terminalState = live.terminalState;
      liveNextAction = live.nextAction;
    }
  }

  const next = liveNextAction ?? nextVerifyChangeAction(plan, baseRef, input.configFile, proof);
  if (proof && !livePilot.attempted && !isExecutableVerificationPlan(plan)) {
    livePilot = {
      available: false,
      attempted: false,
      reason:
        "The durable Proof was created, but the reviewed plan is not executable; no target was controlled.",
    };
  }
  return {
    schemaVersion: 1,
    kind: "verify-change-plan",
    configFile: configPath,
    git: { repositoryRoot, baseRef, baseSha, headSha: testedSha, changedFiles },
    plan,
    proofStart,
    ...(proof === undefined ? {} : { proof }),
    ...(proofStartResponse === undefined ? {} : { proofStartResponse }),
    ...(proofApprovalResponse === undefined ? {} : { proofApprovalResponse }),
    execution: {
      confirmationRequired: true,
      confirmed: input.confirm,
      proofStarted: proof !== undefined,
      planApproved,
      pilot: livePilot,
      runs: liveRuns,
      ...(terminalState ? { terminalState } : {}),
      nextAction: next,
    },
    uncertainty: {
      coverageGaps: plan.coverageGaps,
      residualRisk: proofStart.residualRisk ?? [],
    },
  };
}
