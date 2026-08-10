import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { redactText } from "@relay/core";
import {
  projectRoles,
  type ActorIdentity,
  type ActorKind,
  type ProjectRole,
} from "@relay/protocol";

const MIN_TOKEN_LENGTH = 24;

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

export function assertSafeBinding(host: string, token?: string): void {
  if (isLoopbackHost(host)) return;
  if (!token) {
    throw new Error(
      `Refusing to bind ${host} without authentication. Pass --token or set RELAY_AUTH_TOKEN.`,
    );
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `Server authentication tokens must be at least ${MIN_TOKEN_LENGTH} characters.`,
    );
  }
}

export function authorizationMatches(
  header: string | undefined,
  token: string | undefined,
): boolean {
  if (!token) return true;
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const supplied = Buffer.from(header.slice(prefix.length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * Browsers can reach loopback services from arbitrary web pages. Only Relay's
 * own loopback renderer origins may use the unauthenticated local API. Native
 * clients do not send Origin and continue to use the local trust path.
 */
export function allowedBrowserOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return isLoopbackHost(parsed.hostname) ? parsed.origin : null;
}

/** Workspace assets do not carry project ownership yet. Keep them on the local
 * control plane until their stores can enforce ownership instead of pretending
 * a bearer token makes a global recipe, target, or discovery project-safe. */
export function isLocalWorkspacePath(pathname: string): boolean {
  return [
    "/actions",
    "/audit",
    "/devices",
    "/targets",
    "/target-profiles",
    "/recipes",
    "/discovery",
    "/settings/privacy",
    "/settings/evidence",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export type RequestContext = {
  subject: string;
  organizationId: string;
  projectId: string;
  allowedProjects: string[];
  tokenKind: "local" | "service";
  localTrusted: boolean;
  role: ProjectRole;
};

const REMOTE_ACTOR_KIND: ActorKind = "agent";

/** Derive audit identity from the trust boundary. Local, unauthenticated hosts
 * may identify the human or agent using them. Authenticated service tokens are
 * the actor and cannot claim to be an arbitrary human or system process. */
export function resolveCommandActor(
  headers: IncomingHttpHeaders,
  context: RequestContext,
): ActorIdentity {
  const requestedId = header(headers, "x-relay-actor-id");
  const requestedKind = header(headers, "x-relay-actor-kind");
  if (!context.localTrusted) {
    if (requestedId && requestedId !== context.subject) {
      throw new Error("Authenticated actorId must match the service subject");
    }
    if (requestedKind && requestedKind !== REMOTE_ACTOR_KIND) {
      throw new Error("Authenticated service actors must use actorKind agent");
    }
    return { actorId: context.subject, actorKind: REMOTE_ACTOR_KIND };
  }

  const actorId = requestedId ?? context.subject;
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(actorId)) {
    throw new Error("Local actorId contains unsupported characters");
  }
  const actorKind = requestedKind ?? "human";
  if (actorKind !== "human" && actorKind !== "agent" && actorKind !== "system") {
    throw new Error("Local actorKind must be human, agent, or system");
  }
  return { actorId, actorKind };
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function configuredProjectRole(): ProjectRole {
  const value = process.env.RELAY_AUTH_ROLE?.trim() || "admin";
  if (!projectRoles.includes(value as ProjectRole)) {
    throw new Error("RELAY_AUTH_ROLE must be viewer, author, runner, or admin");
  }
  return value as ProjectRole;
}

/** Minimal configuration-backed scope model until a product identity provider is selected. */
export function resolveRequestContext(
  headers: IncomingHttpHeaders,
  options: { authenticated: boolean; localTrusted: boolean },
): RequestContext {
  if (options.localTrusted && !options.authenticated) {
    return {
      subject: "local-user",
      organizationId: header(headers, "x-organization-id") ?? "local",
      projectId: header(headers, "x-project-id") ?? "default",
      allowedProjects: [header(headers, "x-project-id") ?? "default"],
      tokenKind: "local",
      localTrusted: true,
      role: "admin",
    };
  }
  const organizationId = process.env.RELAY_AUTH_ORGANIZATION_ID?.trim() || "local";
  const allowedProjects = (process.env.RELAY_AUTH_PROJECT_IDS ?? "default")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedOrganization = header(headers, "x-organization-id") ?? organizationId;
  const requestedProject = header(headers, "x-project-id") ?? allowedProjects[0] ?? "default";
  if (requestedOrganization !== organizationId || !allowedProjects.includes(requestedProject)) {
    throw new Error("Authenticated token is not authorized for the requested scope");
  }
  return {
    subject: process.env.RELAY_AUTH_SUBJECT?.trim() || "configured-service",
    organizationId,
    projectId: requestedProject,
    allowedProjects,
    tokenKind: "service",
    localTrusted: false,
    role: configuredProjectRole(),
  };
}

export type AuditEvent = {
  at: number;
  subject: string;
  organizationId: string;
  projectId: string;
  action: string;
  resource?: string;
  target?: string;
  result: "allow" | "deny";
};

const auditEvents: AuditEvent[] = [];

export function recordAudit(
  context: RequestContext,
  event: Omit<AuditEvent, "at" | "subject" | "organizationId" | "projectId">,
): void {
  auditEvents.push({
    at: Date.now(),
    subject: redactText(context.subject),
    organizationId: context.organizationId,
    projectId: context.projectId,
    ...event,
    ...(event.target ? { target: redactText(event.target) } : {}),
  });
  if (auditEvents.length > 1_000) auditEvents.splice(0, auditEvents.length - 1_000);
}

export function listAuditEvents(limit = 100): AuditEvent[] {
  return auditEvents.slice(-Math.max(1, Math.min(limit, 1_000)));
}
