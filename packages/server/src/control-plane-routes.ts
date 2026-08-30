import type http from "node:http";
import {
  buildTargetProfiles,
  currentOperationContext,
  deleteCompatibilityMatrix,
  DEVICE_LEASE_TTL_MS,
  formatMatrixYaml,
  generateValues,
  leaseDevice,
  listBuilds,
  listCompatibilityMatrices,
  listDeviceLeases,
  listDevicePools,
  listDevices,
  listProjects,
  listTargets,
  now,
  parseMatrixYaml,
  readCompatibilityMatrix,
  readProjectVariables,
  releaseDeviceLease,
  resolveCompatibilityMatrix,
  saveBuild,
  saveCompatibilityMatrix,
  saveDevicePool,
  saveProject,
  takeOverDeviceLease,
  writeProjectVariables,
} from "@relay/core";
import type {
  Build,
  DevicePool,
  GenerationRequest,
  Project,
  RevisionWrite,
  TestData,
} from "@relay/protocol";
import { localControlSessionOwner } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

type ControlPlaneRouteInput = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

export async function handleControlPlaneRoute(input: ControlPlaneRouteInput): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = input;
  if (method === "GET" && pathname === "/projects") {
    json(response, 200, { projects: await listProjects(scope.organizationId) });
    return true;
  }
  if (method === "POST" && pathname === "/projects") {
    const body = (await parseJsonBody(request)) as Partial<Project>;
    if (!body.id?.trim() || !body.name?.trim()) {
      throw new HttpError(400, "id and name are required");
    }
    const project = await saveProject({
      id: body.id.trim(),
      name: body.name.trim(),
      organizationId: scope.organizationId,
    });
    json(response, 201, { project });
    return true;
  }
  if (method === "GET" && pathname === "/builds") {
    json(response, 200, { builds: await listBuilds(scope.projectId) });
    return true;
  }
  if (method === "POST" && pathname === "/builds") {
    const body = (await parseJsonBody(request)) as Partial<Build>;
    if (
      !body.id ||
      !body.name ||
      (body.platform !== "android" && body.platform !== "ios" && body.platform !== "web")
    ) {
      throw new HttpError(400, "id, name, and a valid platform are required");
    }
    let sourceUrl: string | undefined;
    let sourceSha256: string | undefined;
    const sourceSha = body.sourceSha?.trim() || undefined;
    if (sourceSha && !/^[a-f0-9]{40}$/u.test(sourceSha)) {
      throw new HttpError(400, "sourceSha must be an exact lowercase 40-character Git SHA");
    }
    const configuration = body.configuration?.trim() || undefined;
    const environmentRevision = body.environmentRevision?.trim() || undefined;
    const applicationId = body.applicationId?.trim() || undefined;
    const deploymentDigest = body.deploymentDigest?.trim().toLowerCase() || undefined;
    const rawSource = body.sourceUrl?.trim();
    if (rawSource) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawSource)) {
        // Only absolute https is accepted for remote ingest; file:/http:
        // sources are rejected so registration never fetches untrusted
        // plaintext or unexpected local filesystem content through a URL.
        try {
          const parsed = new URL(rawSource);
          if (parsed.protocol !== "https:") {
            throw new HttpError(400, "Remote build sourceUrl must be an absolute https URL");
          }
          sourceUrl = rawSource;
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, `Remote build sourceUrl is not a valid URL: ${rawSource}`);
        }
      } else {
        // Bare absolute or workspace-relative paths keep their existing
        // local-artifact semantics.
        sourceUrl = rawSource;
      }
      sourceSha256 = body.sourceSha256?.trim() || undefined;
      if (sourceSha256 && !/^[a-f0-9]{64}$/i.test(sourceSha256)) {
        throw new HttpError(400, "sourceSha256 must be a hex sha256 digest");
      }
    }
    if (body.platform === "web") {
      if (!sourceUrl) {
        throw new HttpError(400, "Web deployments require an immutable https sourceUrl");
      }
      let deploymentUrl: URL;
      try {
        deploymentUrl = new URL(sourceUrl);
      } catch {
        throw new HttpError(400, "Web deployment sourceUrl must be an absolute URL");
      }
      const loopback =
        deploymentUrl.protocol === "http:" &&
        (deploymentUrl.hostname === "localhost" ||
          deploymentUrl.hostname === "127.0.0.1" ||
          deploymentUrl.hostname === "[::1]");
      if (deploymentUrl.protocol !== "https:" && !loopback) {
        throw new HttpError(400, "Web deployment sourceUrl must use https or a loopback URL");
      }
      if (!deploymentDigest || !/^sha256:[a-f0-9]{64}$/u.test(deploymentDigest)) {
        throw new HttpError(400, "Web deployments require a sha256 deploymentDigest");
      }
      if (!sourceSha || !/^[a-f0-9]{40}$/u.test(sourceSha)) {
        throw new HttpError(
          400,
          "Web deployments require an exact lowercase 40-character sourceSha",
        );
      }
      if (!configuration || !environmentRevision) {
        throw new HttpError(
          400,
          "Web deployments require configuration and environmentRevision provenance",
        );
      }
      if (sourceSha256) {
        throw new HttpError(
          400,
          "Web deployments use deploymentDigest instead of mobile sourceSha256",
        );
      }
    }
    const build = await saveBuild({
      id: body.id,
      projectId: scope.projectId,
      name: body.name,
      platform: body.platform,
      sourceUrl,
      sourceSha256,
      sourceSha,
      configuration,
      environmentRevision,
      applicationId,
      deploymentDigest,
      status: body.status ?? "uploaded",
    });
    json(response, 201, { build });
    return true;
  }
  if (method === "GET" && pathname === "/device-pools") {
    json(response, 200, { pools: await listDevicePools(scope.projectId) });
    return true;
  }
  if (method === "POST" && pathname === "/device-pools") {
    const body = (await parseJsonBody(request)) as Partial<DevicePool>;
    if (!body.id || !body.name || !Array.isArray(body.deviceSerials)) {
      throw new HttpError(400, "id, name, and deviceSerials are required");
    }
    const pool = await saveDevicePool({
      id: body.id,
      projectId: scope.projectId,
      name: body.name,
      platform: body.platform ?? "mixed",
      deviceSerials: body.deviceSerials.map(String),
    });
    json(response, 201, { pool });
    return true;
  }
  if (method === "GET" && pathname === "/target-profiles") {
    const devices = await listDevices().catch(() => []);
    json(response, 200, {
      profiles: buildTargetProfiles({ devices, targets: await listTargets() }),
    });
    return true;
  }
  if (method === "GET" && pathname === "/matrices") {
    json(response, 200, { matrices: await listCompatibilityMatrices(scope.projectId) });
    return true;
  }
  const matrixYamlMatch = matchPath(pathname, "/matrices/:id/yaml");
  if (method === "GET" && matrixYamlMatch) {
    const matrix = await readCompatibilityMatrix(scope.projectId, matrixYamlMatch.id!);
    if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
    json(response, 200, { yaml: formatMatrixYaml(matrix) });
    return true;
  }
  if (method === "POST" && pathname === "/matrices/import") {
    const body = (await parseJsonBody(request)) as {
      yaml?: string;
      conflict?: "reject" | "replace";
    };
    if (!body.yaml?.trim()) throw new HttpError(400, "yaml is required");
    let parsed;
    try {
      parsed = parseMatrixYaml(body.yaml, {
        projectId: scope.projectId,
        createdAt: 0,
        updatedAt: 0,
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    const existing = await readCompatibilityMatrix(scope.projectId, parsed.id);
    if (existing && body.conflict !== "replace") {
      throw new HttpError(409, `Compatibility matrix “${parsed.id}” already exists`);
    }
    const matrix = await saveCompatibilityMatrix({
      id: parsed.id,
      projectId: scope.projectId,
      name: parsed.name,
      selectors: parsed.selectors,
    });
    json(response, existing ? 200 : 201, { matrix });
    return true;
  }
  if (method === "POST" && pathname === "/matrices") {
    const body = (await parseJsonBody(request)) as {
      id?: string;
      name?: string;
      selectors?: import("@relay/protocol").TargetSelector[];
    };
    if (!body.id || !body.name || !Array.isArray(body.selectors)) {
      throw new HttpError(400, "id, name, and selectors are required");
    }
    try {
      const matrix = await saveCompatibilityMatrix({
        id: body.id,
        projectId: scope.projectId,
        name: body.name,
        selectors: body.selectors,
      });
      json(response, 201, { matrix });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const matrixMatch = matchPath(pathname, "/matrices/:id");
  if (method === "PUT" && matrixMatch) {
    const existing = await readCompatibilityMatrix(scope.projectId, matrixMatch.id!);
    if (!existing) throw new HttpError(404, "Compatibility matrix not found");
    const body = (await parseJsonBody(request)) as {
      name?: string;
      selectors?: import("@relay/protocol").TargetSelector[];
    };
    try {
      const matrix = await saveCompatibilityMatrix({
        id: existing.id,
        projectId: scope.projectId,
        name: body.name ?? existing.name,
        selectors: body.selectors ?? existing.selectors,
      });
      json(response, 200, { matrix });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  if (method === "DELETE" && matrixMatch) {
    await deleteCompatibilityMatrix(scope.projectId, matrixMatch.id!);
    json(response, 200, { ok: true });
    return true;
  }
  const matrixResolveMatch = matchPath(pathname, "/matrices/:id/resolve");
  if (method === "POST" && matrixResolveMatch) {
    const matrix = await readCompatibilityMatrix(scope.projectId, matrixResolveMatch.id!);
    if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
    const devices = await listDevices().catch(() => []);
    json(response, 200, {
      expansion: resolveCompatibilityMatrix(
        matrix,
        buildTargetProfiles({ devices, targets: await listTargets() }),
      ),
    });
    return true;
  }
  if (method === "GET" && pathname === "/device-leases") {
    const status = url.searchParams.get("status") ?? "active";
    const leases = await listDeviceLeases(scope.projectId);
    json(response, 200, {
      leases: status === "all" ? leases : leases.filter((lease) => lease.status === "leased"),
    });
    return true;
  }
  if (method === "POST" && pathname === "/device-leases") {
    const body = (await parseJsonBody(request)) as {
      poolId?: string;
      deviceSerial?: string;
      expiresAt?: number;
    };
    if (!body.poolId || !body.deviceSerial) {
      throw new HttpError(400, "poolId and deviceSerial are required");
    }
    try {
      const localOwner = scope.localTrusted ? localControlSessionOwner(scope) : undefined;
      const joined = localOwner
        ? (await listDeviceLeases(scope.projectId)).find(
            (lease) =>
              lease.deviceSerial === body.deviceSerial &&
              lease.ownerId === localOwner &&
              lease.controlScope === "local-project" &&
              lease.status === "leased" &&
              lease.expiresAt > now(),
          )
        : undefined;
      if (joined) {
        json(response, 200, { lease: joined });
        return true;
      }
      const lease = await leaseDevice({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        poolId: body.poolId,
        deviceSerial: body.deviceSerial,
        ownerId: localOwner ?? currentOperationContext()!.actorId,
        ...(localOwner ? { controlScope: "local-project" as const } : {}),
        expiresAt: body.expiresAt ?? now() + DEVICE_LEASE_TTL_MS,
      });
      json(response, 201, { lease });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const takeoverLeaseMatch = matchPath(pathname, "/device-leases/:id/takeover");
  if (method === "POST" && takeoverLeaseMatch) {
    const body = (await parseJsonBody(request)) as {
      expiresAt?: number;
      reason?: string;
      confirm?: boolean;
    };
    if (body.confirm !== true) throw new HttpError(403, "Explicit takeover confirmation required");
    if (!body.reason?.trim()) throw new HttpError(400, "A takeover reason is required");
    try {
      json(response, 200, {
        lease: await takeOverDeviceLease(takeoverLeaseMatch.id!, {
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          ownerId: scope.localTrusted
            ? localControlSessionOwner(scope)
            : currentOperationContext()!.actorId,
          ...(scope.localTrusted ? { controlScope: "local-project" as const } : {}),
          expiresAt: body.expiresAt ?? now() + DEVICE_LEASE_TTL_MS,
          reason: body.reason,
        }),
      });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const releaseLeaseMatch = matchPath(pathname, "/device-leases/:id/release");
  if (method === "POST" && releaseLeaseMatch) {
    try {
      const shared = scope.localTrusted
        ? (await listDeviceLeases(scope.projectId)).find(
            (lease) =>
              lease.id === releaseLeaseMatch.id &&
              lease.ownerId === localControlSessionOwner(scope) &&
              lease.controlScope === "local-project" &&
              lease.status === "leased",
          )
        : undefined;
      if (shared) {
        json(response, 200, { lease: shared });
        return true;
      }
      json(response, 200, {
        lease: await releaseDeviceLease(releaseLeaseMatch.id!, {
          projectId: scope.projectId,
          ownerId: currentOperationContext()!.actorId,
        }),
      });
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  if (method === "GET" && pathname === "/project/variables") {
    json(response, 200, await readProjectVariables(scope.projectId));
    return true;
  }
  if (method === "PUT" && pathname === "/project/variables") {
    const body = (await parseJsonBody(request)) as RevisionWrite<TestData[]>;
    if (!Number.isInteger(body.expectedRevision) || !Array.isArray(body.value)) {
      throw new HttpError(400, "expectedRevision and value are required");
    }
    body.idempotencyKey ||= request.headers["idempotency-key"] as string | undefined;
    json(response, 200, await writeProjectVariables(scope.projectId, body));
    return true;
  }
  if (method === "POST" && pathname === "/generate") {
    const body = (await parseJsonBody(request)) as GenerationRequest;
    if (!body.prompt?.trim() || (body.purpose !== "variable" && body.purpose !== "test-plan")) {
      throw new HttpError(400, "purpose and prompt are required");
    }
    json(response, 200, await generateValues(body));
    return true;
  }
  return false;
}
