import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { redactText } from "@relay/core";
import {
  projectRoles,
  type ActorIdentity,
  type ActorKind,
  type ProjectRole,
} from "@relay/protocol";
import {
  isVerifiedExternalIdentity,
  verifyExternalBearerToken,
  type ExternalIdentityActorKind,
  type ExternalIdentityVerifier,
  type VerifiedExternalIdentity,
} from "./external-identity.js";

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

/**
 * Normalize a web Origin without ever accepting a path, credential, or opaque
 * origin as a CORS authority. Relay deliberately does not support wildcards:
 * an allowed browser must be named by its exact scheme/host/port origin.
 */
function normalizeHttpOrigin(value: string | undefined): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }
  return parsed.origin;
}

/**
 * Parse Relay-owned browser origins from an embedding host or
 * RELAY_ALLOWED_BROWSER_ORIGINS. Invalid entries fail startup instead of
 * silently widening (or unexpectedly disabling) the CORS boundary.
 */
export function configuredBrowserOrigins(
  raw = process.env.RELAY_ALLOWED_BROWSER_ORIGINS,
): readonly string[] {
  if (!raw?.trim()) return [];
  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const normalized = normalizeHttpOrigin(value);
      if (!normalized) {
        throw new Error(
          `RELAY_ALLOWED_BROWSER_ORIGINS contains an invalid origin: ${JSON.stringify(value)}`,
        );
      }
      return normalized;
    });
  if (!origins.length) {
    throw new Error("RELAY_ALLOWED_BROWSER_ORIGINS must contain at least one HTTP(S) origin");
  }
  return [...new Set(origins)];
}

export function assertSafeBinding(
  host: string,
  token?: string,
  externalIdentityVerifier?: ExternalIdentityVerifier,
): void {
  if (isLoopbackHost(host)) return;
  if (!token && !externalIdentityVerifier) {
    throw new Error(
      `Refusing to bind ${host} without authentication. Pass --token, set RELAY_AUTH_TOKEN, or install a verified external identity verifier.`,
    );
  }
  if (token && token.length < MIN_TOKEN_LENGTH) {
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

function bearerCredential(header: string | undefined): string | undefined {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return undefined;
  const credential = header.slice(prefix.length);
  return credential || undefined;
}

export type RequestAuthentication =
  | { kind: "local" }
  | { kind: "service" }
  | { kind: "external"; identity: VerifiedExternalIdentity };

/**
 * Authenticate before resolving project scope. External bearer credentials are
 * opaque to Relay and accepted only through a runtime-branded verifier result;
 * decoded JWT claims and verifier errors both fail closed.
 */
export async function authenticateRequest(
  header: string | undefined,
  options: {
    token?: string;
    externalIdentityVerifier?: ExternalIdentityVerifier;
    localTrusted: boolean;
    now?: number;
  },
): Promise<RequestAuthentication | undefined> {
  if (options.token && authorizationMatches(header, options.token)) return { kind: "service" };

  const credential = bearerCredential(header);
  if (options.externalIdentityVerifier && credential) {
    const identity = await verifyExternalBearerToken(
      options.externalIdentityVerifier,
      credential,
      options.now,
    );
    if (identity) return { kind: "external", identity };
  }

  // Preserve ordinary loopback behavior. Once a static token is configured it
  // remains mandatory there as before; an external verifier alone does not
  // remove the desktop's local-trust path when no credential is supplied.
  if (!options.token && options.localTrusted && (!options.externalIdentityVerifier || !header)) {
    return { kind: "local" };
  }
  return undefined;
}

/**
 * Browsers can reach loopback services from arbitrary web pages. An
 * unauthenticated browser must exactly match an explicit Relay-owned origin.
 * Native clients do not send Origin and continue to use the local trust path.
 */
export function allowedBrowserOrigin(
  origin: string | undefined,
  configuredOrigins = configuredBrowserOrigins(),
): string | null {
  const normalized = normalizeHttpOrigin(origin);
  return normalized && configuredOrigins.includes(normalized) ? normalized : null;
}

/** A valid HTTP(S) origin may use CORS only after the request proves bearer
 * authentication. This lets self-managed remote browser clients opt in with a
 * token without treating every local web page as a trusted Relay renderer. */
export function authenticatedBrowserOrigin(origin: string | undefined): string | null {
  return normalizeHttpOrigin(origin);
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
  tokenKind: "local" | "service" | "external";
  localTrusted: boolean;
  role: ProjectRole;
  /** Only external identities can derive a non-agent remote actor kind. */
  externalActorKind?: ExternalIdentityActorKind;
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
    const actorKind =
      context.tokenKind === "external" ? (context.externalActorKind ?? "human") : REMOTE_ACTOR_KIND;
    if (requestedId && requestedId !== context.subject) {
      throw new Error("Authenticated actorId must match the authenticated subject");
    }
    if (requestedKind && requestedKind !== actorKind) {
      throw new Error(
        `Authenticated ${context.tokenKind === "external" ? "external" : "service"} actors must use actorKind ${actorKind}`,
      );
    }
    return { actorId: context.subject, actorKind };
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

/**
 * A network-visible static bearer has no issuer-backed claims from which
 * Relay can safely infer access. Refuse defaults that would otherwise turn a
 * typo into a remote administrator for `local/default`.
 */
export function assertExplicitRemoteServiceTokenScope(host: string, token?: string): void {
  if (isLoopbackHost(host) || !token) return;
  const role = process.env.RELAY_AUTH_ROLE?.trim();
  const organization = process.env.RELAY_AUTH_ORGANIZATION_ID?.trim();
  const projects = (process.env.RELAY_AUTH_PROJECT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const missing = [
    ...(role ? [] : ["RELAY_AUTH_ROLE"]),
    ...(organization ? [] : ["RELAY_AUTH_ORGANIZATION_ID"]),
    ...(projects.length ? [] : ["RELAY_AUTH_PROJECT_IDS"]),
  ];
  if (missing.length) {
    throw new Error(
      `Non-loopback static-token bindings require explicit ${missing.join(", ")}; Relay will not default remote service tokens to admin/local/default scope.`,
    );
  }
  configuredProjectRole();
}

function resolveExternalRequestContext(
  headers: IncomingHttpHeaders,
  identity: VerifiedExternalIdentity,
): RequestContext {
  if (!isVerifiedExternalIdentity(identity)) {
    throw new Error("External identity verifier returned an untrusted identity");
  }
  const requestedOrganization = header(headers, "x-organization-id") ?? identity.organizationId;
  if (requestedOrganization !== identity.organizationId) {
    throw new Error("External identity is not authorized for the requested organization");
  }
  const allowedProjects = Object.keys(identity.projectRoles);
  const requestedProject =
    header(headers, "x-project-id") ??
    (allowedProjects.length === 1 ? allowedProjects[0] : undefined);
  if (!requestedProject || !Object.hasOwn(identity.projectRoles, requestedProject)) {
    throw new Error("External identity is not authorized for the requested project");
  }
  const role = identity.projectRoles[requestedProject];
  if (!role) throw new Error("External identity has no role for the requested project");
  return {
    subject: identity.subject,
    organizationId: identity.organizationId,
    projectId: requestedProject,
    allowedProjects,
    tokenKind: "external",
    localTrusted: false,
    role,
    externalActorKind: identity.actorKind,
  };
}

/** Resolve local, static-service, or already verified external identity scope. */
export function resolveRequestContext(
  headers: IncomingHttpHeaders,
  options: {
    authenticated: boolean;
    localTrusted: boolean;
    externalIdentity?: VerifiedExternalIdentity;
  },
): RequestContext {
  if (options.externalIdentity) {
    if (!options.authenticated) throw new Error("External identity must be authenticated");
    return resolveExternalRequestContext(headers, options.externalIdentity);
  }
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
  /**
   * The command actor when a route can distinguish it from the authenticated
   * subject. This matters on the local host, where several Relay windows may
   * share one trusted session but must remain individually attributable.
   */
  actorId?: string;
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
    ...(event.actorId ? { actorId: redactText(event.actorId) } : {}),
    ...(event.target ? { target: redactText(event.target) } : {}),
  });
  if (auditEvents.length > 1_000) auditEvents.splice(0, auditEvents.length - 1_000);
}

export function listAuditEvents(limit = 100): AuditEvent[] {
  return auditEvents.slice(-Math.max(1, Math.min(limit, 1_000)));
}
