import { operationDefinitions, projectRoleAllows, type ProjectRole } from "@relay/protocol";
import { parseMcpConfig, type McpConfig } from "./config.js";
import {
  relayMcpProfiles,
  relayMcpToolsForProfile,
  relayToolName,
  type RelayMcpProfile,
} from "./tools.js";

import { relayQaRequiredOperationIds } from "./qa-tools.js";

const ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u;
const ROLE_ORDER: readonly ProjectRole[] = ["viewer", "author", "runner", "admin"];

/**
 * The Proof lifecycle is intentionally derived from the canonical operation
 * registry. Keep this module a diagnostic, not a second list of Proof
 * schemas or transport semantics.
 */
function proofToolsForProfile(profile: RelayMcpProfile) {
  return relayMcpToolsForProfile(profile).filter(({ operationId }) =>
    operationId.startsWith("proof."),
  );
}

/**
 * Canonical operations the default operator verbs hard-depend on. The
 * dispatch table in operator-tool-dispatch.ts is the source of truth; this
 * diagnostic list only names its non-escape-hatch dependencies. Extend it
 * when a verb gains a new hard dependency.
 */
const operatorCoreOperationIds: readonly string[] = [
  "system.health.get",
  "target.devices.list",
  "lane.list",
  "lease.create",
  "lease.list",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "target.interact",
  "target.recover",
  "job.get",
  "job.cancel",
  "job.combine.start",
  "job.combine.export",
  "job.combine.analysis",
  "app-map.test.save",
  "run.evidence.get",
  "run.walkthrough-pack.get",
  "run.visual.review",
  "run.visual.compare",
];

function expectedOperationsForProfile(profile: RelayMcpProfile) {
  if (profile === "qa") {
    return relayQaRequiredOperationIds.map((operationId) => ({ operationId }));
  }
  if (profile === "operator") {
    return operatorCoreOperationIds.map((operationId) => ({ operationId }));
  }
  if (profile === "proof" || profile === "full") {
    return proofToolsForProfile(profile);
  }
  return relayMcpToolsForProfile(profile);
}

export type RelayMcpDoctorCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly message: string;
};

export type RelayMcpDoctorReport = {
  readonly ok: boolean;
  readonly config: {
    readonly server: string;
    readonly organization: string;
    readonly project: string;
    readonly actor: string;
    readonly actorKind: "agent";
    readonly profile: RelayMcpProfile;
  };
  readonly proofTools: readonly string[];
  readonly checks: readonly RelayMcpDoctorCheck[];
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function roleFromHealth(value: unknown): ProjectRole | undefined {
  const health = asObject(value);
  const access = asObject(health?.access);
  const role = access?.role;
  return typeof role === "string" && ROLE_ORDER.includes(role as ProjectRole)
    ? (role as ProjectRole)
    : undefined;
}

function authHeaders(config: McpConfig): HeadersInit {
  const headers: Record<string, string> = {
    "X-Relay-Actor-Id": config.connection.actorId,
    "X-Relay-Actor-Kind": config.connection.actorKind,
  };
  if (config.connection.auth.type === "bearer") {
    headers.Authorization = `Bearer ${config.connection.auth.token}`;
  }
  return headers;
}

async function getJson(
  url: string,
  config: McpConfig,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body?: unknown; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 15_000));
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: authHeaders(config),
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  } catch (error) {
    return {
      status: 0,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "request timed out"
          : "request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function check(name: string, ok: boolean, message: string): RelayMcpDoctorCheck {
  return Object.freeze({ name, ok, message });
}

function configForDoctor(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): { config: McpConfig; json: boolean } {
  const configArgs: string[] = [];
  let json = false;
  for (const argument of argv) {
    if (argument === "--json") json = true;
    else configArgs.push(argument);
  }
  // Doctor validates exactly the profile the client will run — the default
  // operator surface on a clean host, or an explicitly selected specialist.
  // No implicit profile switch: ordinary setup must not be judged by the
  // Proof lifecycle, and a Proof host passes --profile proof explicitly.
  return { config: parseMcpConfig(configArgs, env), json };
}

export async function runRelayMcpDoctor(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayMcpDoctorReport> {
  const { config } = configForDoctor(argv, env);
  const checks: RelayMcpDoctorCheck[] = [];
  const proofLifecycle = config.profile === "proof" || config.profile === "full";
  const expectedTools = expectedOperationsForProfile(config.profile);
  const selectedTools = proofLifecycle ? proofToolsForProfile(config.profile) : expectedTools;

  checks.push(
    check(
      "profile",
      expectedTools.length > 0,
      proofLifecycle
        ? `${config.profile} exposes the complete Proof lifecycle`
        : `profile ${config.profile} requires ${expectedTools.length} server operations for ordinary agent work; the Proof lifecycle needs --profile proof`,
    ),
  );

  checks.push(
    check(
      "actor",
      config.connection.actorKind === "agent" && ACTOR_ID_PATTERN.test(config.connection.actorId),
      config.connection.actorKind === "agent"
        ? ACTOR_ID_PATTERN.test(config.connection.actorId)
          ? `agent identity ${config.connection.actorId} is valid and will be sent to Relay`
          : "RELAY_ACTOR_ID contains unsupported characters"
        : "the Relay plugin must use an agent actor identity",
    ),
  );

  const healthUrl = new URL("/health", config.connection.url).toString();
  const health = await getJson(healthUrl, config, fetchImpl);
  const healthBody = asObject(health.body);
  checks.push(
    check(
      "reachability",
      health.status >= 200 && health.status < 300 && healthBody?.ok === true,
      health.status === 0
        ? `${config.connection.url} is unreachable (${health.error ?? "request failed"})`
        : health.status >= 200 && health.status < 300 && healthBody?.ok === true
          ? `Relay is reachable at ${config.connection.url}`
          : `Relay returned HTTP ${health.status}`,
    ),
  );

  const access = asObject(healthBody?.access);
  const role = roleFromHealth(health.body);
  checks.push(
    check(
      "scope",
      access?.organizationId === config.connection.organizationId &&
        access?.projectId === config.connection.projectId,
      access?.organizationId === config.connection.organizationId &&
        access?.projectId === config.connection.projectId
        ? `server scope is ${config.connection.organizationId}/${config.connection.projectId}`
        : "server scope does not match RELAY_ORGANIZATION_ID/RELAY_PROJECT_ID",
    ),
  );

  const requiredRoles = selectedTools
    .map(
      ({ operationId }) => operationDefinitions.find(({ id }) => id === operationId)?.minimumRole,
    )
    .filter((value): value is ProjectRole => value !== undefined);
  const requiredRole = requiredRoles.reduce<ProjectRole>(
    (highest, candidate) =>
      ROLE_ORDER.indexOf(candidate) > ROLE_ORDER.indexOf(highest) ? candidate : highest,
    "viewer",
  );
  checks.push(
    check(
      "capabilities",
      role !== undefined && projectRoleAllows(role, requiredRole),
      role === undefined
        ? "Relay did not return a project role in /health"
        : projectRoleAllows(role, requiredRole)
          ? `project role ${role} can invoke the selected profile (up to ${requiredRole})`
          : `project role ${role} cannot invoke the selected profile; requires ${requiredRole}`,
    ),
  );

  const approval = operationDefinitions.find(({ id }) => id === "proof.plan.approve");
  const approvalTool = relayMcpToolsForProfile("proof").find(
    ({ operationId }) => operationId === "proof.plan.approve",
  );
  const approvalOk =
    approval?.minimumRole === "author" &&
    approval.confirmation === "confirm" &&
    approvalTool?.requiresConfirmation === true;
  if (proofLifecycle)
    checks.push(
      check(
        "approval",
        approvalOk,
        approvalOk
          ? "plan approval is human-confirmed at the canonical operation boundary; this agent cannot self-approve"
          : "canonical proof.plan.approve is missing its author role or confirmation guard",
      ),
    );

  const metaUrl = new URL("/meta", config.connection.url).toString();
  const meta = await getJson(metaUrl, config, fetchImpl);
  const metaOperations = asObject(meta.body)?.operations;
  const operations = Array.isArray(metaOperations)
    ? metaOperations
        .map((entry) => asObject(entry)?.id)
        .filter((id): id is string => typeof id === "string")
    : [];
  const serverOperationIds = new Set(operations);
  const missing = expectedTools
    .filter(({ operationId }) => !serverOperationIds.has(operationId))
    .map(({ operationId }) => operationId);
  checks.push(
    check(
      "proof-tools",
      meta.status >= 200 && meta.status < 300 && missing.length === 0,
      meta.status === 0
        ? `could not inspect the server operation manifest (${meta.error ?? "request failed"})`
        : missing.length === 0
          ? `server exposes all ${expectedTools.length} operations for profile ${config.profile}`
          : `server manifest is missing: ${missing.join(", ")}`,
    ),
  );

  return Object.freeze({
    ok: checks.every(({ ok }) => ok),
    config: Object.freeze({
      server: config.connection.url,
      organization: config.connection.organizationId,
      project: config.connection.projectId,
      actor: config.connection.actorId,
      actorKind: "agent",
      profile: config.profile,
    }),
    proofTools: Object.freeze(
      proofToolsForProfile("proof").map(({ operationId }) => relayToolName(operationId)),
    ),
    checks: Object.freeze(checks),
  });
}

export function formatRelayMcpDoctor(report: RelayMcpDoctorReport): string {
  const remedies: Record<string, string> = {
    reachability:
      "Start your existing Relay service, or set RELAY_URL to its reachable address. Installing @relay/mcp installs the connector only.",
    scope:
      "Set RELAY_ORGANIZATION_ID and RELAY_PROJECT_ID to the authorized scope returned by this Relay service.",
    actor: "Set RELAY_ACTOR_ID to a distinct agent:<name> identity.",
    capabilities:
      "Use credentials with the required project role; keep tokens in the host process environment.",
    "proof-tools":
      "Connect to a compatible Relay runtime with the missing operations; changing the selected target cannot repair a contract mismatch.",
  };
  const lines = [
    `Relay doctor: ${report.ok ? "READY" : "NOT READY"}`,
    `Server: ${report.config.server}`,
    `Scope: ${report.config.organization}/${report.config.project}`,
    `Actor: ${report.config.actor} (${report.config.actorKind})`,
    `Profile: ${report.config.profile}`,
    ...(report.config.profile === "proof" || report.config.profile === "full"
      ? [`Proof tools: ${report.proofTools.join(", ")}`]
      : []),
    "",
    ...report.checks.map(
      ({ name, ok, message }) =>
        `${ok ? "OK" : "FAIL"} ${name}: ${message}${!ok && remedies[name] ? `\n  Next: ${remedies[name]}` : ""}`,
    ),
  ];
  return lines.join("\n");
}

export async function runRelayMcpDoctorCommand(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const json = argv.includes("--json");
  const report = await runRelayMcpDoctor(argv, env, fetchImpl);
  process.stdout.write(`${json ? JSON.stringify(report) : formatRelayMcpDoctor(report)}\n`);
  return report.ok ? 0 : 1;
}

export { relayMcpProfiles };
