import { InputNotDispatchedError } from "@relay/core";
import type http from "node:http";
import {
  cancelJob,
  currentOperationContext,
  authoringSessions,
  getJob,
  listJobs,
  findRepeatCampaignsByWorkflow,
  now,
  readDurableWorkflow,
  readCombineCampaign,
  projectCombineCampaign,
  transitionDurableWorkflow,
  type DurableWorkflowRead,
  type AuthoringRuntime,
  type TestJob,
} from "@relay/core";
import type {
  AuthoringSession,
  CreateAuthoringSessionInput,
  DurableWorkflowRecord,
  OperationInput,
  WorkflowJsonValue,
} from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";
import { assertJobAccess, assertTargetControl, assertTargetLease } from "./access-control.js";
import {
  assertAuthoringTransitionAccess,
  beginControlledAuthoringSession,
  executeControlledAuthoringTransition,
} from "./authoring-routes.js";
import {
  authoringActionIsAllowed,
  authoringIdentityAfterMutation,
  authoringIdentityFromSession,
  authoringIsTerminal,
  authoringRecordFailureIsProven,
  reconcileAuthoring,
  type AuthoringWorkflowTransitionInput,
} from "./workflow-authoring-reconciliation.js";
import {
  assertRepeatWorkflowAccess,
  reconcileRepeat,
  type RepeatReconciliationRuntime,
} from "./workflow-repeat-reconciliation.js";
import {
  transitionRepeatWorkflow,
  type RepeatWorkflowTransitionInput,
} from "./workflow-repeat-transition.js";
import { handleWorkflowCreateRoute } from "./workflow-create-route.js";
import { trackAuthoringDispatch } from "./workflow-authoring-dispatch.js";

const terminalJobStatuses = new Set([
  "ok",
  "healed",
  "succeeded",
  "completed",
  "error",
  "failed",
  "cancelled",
  "canceled",
]);

export type WorkflowRouteRuntime = RepeatReconciliationRuntime & {
  now: typeof now;
  getJob: typeof getJob;
  listJobs: typeof listJobs;
  cancelJob: typeof cancelJob;
  assertTargetControl: typeof assertTargetControl;
  transitionWorkflow: typeof transitionDurableWorkflow;
  authoringRuntime?: AuthoringRuntime;
  getAuthoringSession(id: string): Promise<AuthoringSession>;
  listAuthoringSessions(projectId: string): Promise<AuthoringSession[]>;
  beginAuthoringSession(
    scope: RequestContext,
    input: CreateAuthoringSessionInput,
    runtime?: AuthoringRuntime,
  ): Promise<AuthoringSession>;
  assertAuthoringStartAccess(
    scope: RequestContext,
    targetId: string,
    leaseId: string,
  ): Promise<void>;
  assertAuthoringAccess(
    scope: RequestContext,
    session: AuthoringSession,
    action: AuthoringWorkflowTransitionInput["action"],
  ): Promise<void>;
  transitionAuthoringSession(
    scope: RequestContext,
    sessionId: string,
    input: AuthoringWorkflowTransitionInput,
    runtime?: AuthoringRuntime,
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession>;
};

const defaultRuntime: WorkflowRouteRuntime = {
  now,
  getJob,
  listJobs,
  cancelJob,
  assertTargetControl,
  transitionWorkflow: transitionDurableWorkflow,
  getAuthoringSession: (id) => authoringSessions.get(id),
  listAuthoringSessions: (projectId) => authoringSessions.list(projectId, { includeHistory: true }),
  beginAuthoringSession: beginControlledAuthoringSession,
  assertAuthoringStartAccess: assertTargetLease,
  assertAuthoringAccess: assertAuthoringTransitionAccess,
  transitionAuthoringSession: executeControlledAuthoringTransition,
  readRepeatCampaign: readCombineCampaign,
  findRepeatCampaignsByWorkflow,
  projectRepeatCampaign: projectCombineCampaign,
};

type JsonRecord = Record<string, WorkflowJsonValue>;

function jsonRecord(value: WorkflowJsonValue | undefined): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function artifact(job: TestJob, kind: string): Record<string, unknown> | undefined {
  return job.artifacts.find((candidate) => candidate.kind === kind)?.data as
    | Record<string, unknown>
    | undefined;
}

function workflowNotFound(): never {
  throw new HttpError(404, "Workflow not found");
}

function runIdentityFromJob(
  record: DurableWorkflowRecord,
  job: TestJob,
): WorkflowJsonValue | undefined {
  if (record.kind !== "run-test" || job.projectId !== record.projectId) return undefined;
  const frozen = jsonRecord(record.frozenIdentity);
  if (!frozen) return undefined;
  const requestId = frozen.workflowRequestId;
  if (typeof requestId === "string") {
    const request = artifact(job, "app-map-test-workflow-request");
    if (request?.requestId !== requestId) return undefined;
  } else if (!record.adoptedLegacyRefDigest) return undefined;
  const execution = artifact(job, "app-map-test-execution-intent");
  const sourcePlan =
    execution?.sourcePlan && typeof execution.sourcePlan === "object"
      ? (execution.sourcePlan as Record<string, unknown>)
      : undefined;
  if (
    !sourcePlan ||
    sourcePlan.appMapId !== frozen.appMapId ||
    sourcePlan.appMapRevision !== frozen.appMapRevision ||
    sourcePlan.testId !== frozen.testId ||
    typeof sourcePlan.rootRecipeId !== "string" ||
    !sourcePlan.rootRecipeId ||
    typeof sourcePlan.digest !== "string" ||
    !sourcePlan.digest
  ) {
    return undefined;
  }
  if (frozen.target === undefined) return undefined;
  const target = jsonRecord(frozen.target);
  if (!target) return undefined;
  const targetMatches =
    target.kind === "device"
      ? job.serial === target.targetId && job.platform === target.platform
      : target.kind === "browser"
        ? job.browserTargetId === target.targetId
        : false;
  if (!targetMatches) return undefined;
  return {
    ...frozen,
    rootRecipeId: sourcePlan.rootRecipeId,
    planDigest: sourcePlan.digest,
  };
}

function scopedJob(
  scope: RequestContext,
  runtime: WorkflowRouteRuntime,
  workflow: DurableWorkflowRead,
): TestJob | undefined {
  const resource = workflow.record.resource;
  if (resource?.kind !== "job") return undefined;
  const job = runtime.getJob(resource.id);
  if (!job || job.projectId !== scope.projectId) return undefined;
  return runIdentityFromJob(workflow.record, job) ? job : undefined;
}

function jobIsAccessible(scope: RequestContext, job: TestJob): boolean {
  return scope.localTrusted || (job.projectId === scope.projectId && job.ownerId === scope.subject);
}

async function expireIfNeeded(
  scope: RequestContext,
  workflow: DurableWorkflowRead,
  actorId: string,
  at: number,
): Promise<DurableWorkflowRead> {
  if (workflow.record.status === "expired" || workflow.record.expiresAt > at) return workflow;
  const expired = await transitionDurableWorkflow({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    workflowId: workflow.record.workflowId,
    expectedVersion: workflow.record.version,
    actorId,
    transition: "expired",
    status: "active",
    at,
  });
  return expired.status === "expired" ? expired.current : workflow;
}

async function reconcileRun(
  scope: RequestContext,
  runtime: WorkflowRouteRuntime,
  input: DurableWorkflowRead,
  actorId: string,
  at: number,
): Promise<{ workflow: DurableWorkflowRead; job?: TestJob }> {
  let workflow = await expireIfNeeded(scope, input, actorId, at);
  if (workflow.record.status === "expired") return { workflow };
  let job = scopedJob(scope, runtime, workflow);
  if (job && !jobIsAccessible(scope, job)) assertJobAccess(scope, job);
  if (!job && workflow.record.resource === undefined && workflow.record.kind === "run-test") {
    const correlated = runtime
      .listJobs(100)
      .filter((candidate) => runIdentityFromJob(workflow.record, candidate) !== undefined);
    const matches = correlated.filter((candidate) => jobIsAccessible(scope, candidate));
    if (correlated.length > 0 && matches.length === 0) {
      // A workflow id is only a lookup key. Refuse before changing the record
      // when the only correlated resources belong to another principal.
      assertJobAccess(scope, correlated[0]);
    }
    if (matches.length === 1) {
      job = matches[0]!;
      const attached = await runtime.transitionWorkflow({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        workflowId: workflow.record.workflowId,
        expectedVersion: workflow.record.version,
        actorId,
        transition: "run-reconciled",
        status: terminalJobStatuses.has(job.status) ? "terminal" : "active",
        resource: { kind: "job", id: job.id },
        frozenIdentity: runIdentityFromJob(workflow.record, job)!,
        at,
      });
      if (attached.status === "updated") workflow = attached.workflow;
      else if ("current" in attached) {
        workflow = attached.current;
        job = scopedJob(scope, runtime, workflow);
      }
    } else if (matches.length > 1 && workflow.record.status === "active") {
      const ambiguous = await transitionDurableWorkflow({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        workflowId: workflow.record.workflowId,
        expectedVersion: workflow.record.version,
        actorId,
        transition: "run-reconciliation-ambiguous",
        status: "needs-attention",
        at,
      });
      if (ambiguous.status === "updated") workflow = ambiguous.workflow;
    }
  }
  if (
    job &&
    terminalJobStatuses.has(job.status) &&
    workflow.record.status !== "terminal" &&
    workflow.record.status !== "expired"
  ) {
    const terminal = await transitionDurableWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition: `run-${job.status}`,
      status: "terminal",
      resource: { kind: "job", id: job.id },
      frozenIdentity: runIdentityFromJob(workflow.record, job),
      at,
    });
    if (terminal.status === "updated") workflow = terminal.workflow;
    else if ("current" in terminal) workflow = terminal.current;
  }
  return { workflow, ...(job ? { job } : {}) };
}

export async function handleWorkflowRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<WorkflowRouteRuntime>;
}): Promise<boolean> {
  const runtime = { ...defaultRuntime, ...input.runtime };
  const actorId = currentOperationContext()?.actorId ?? input.scope.subject;
  const at = runtime.now();

  if (
    await handleWorkflowCreateRoute({
      ...input,
      runtime,
      actorId,
      at,
    })
  )
    return true;

  const workflowMatch = matchPath(input.pathname, "/workflows/:workflowId");
  if (input.method === "GET" && workflowMatch) {
    const stored = await readDurableWorkflow({
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      workflowId: workflowMatch.workflowId!,
    });
    if (!stored) workflowNotFound();
    if (stored.record.kind === "author-test") {
      const frozen = jsonRecord(stored.record.frozenIdentity);
      if (!frozen || frozen.actorId !== actorId) workflowNotFound();
    }
    const repeatCampaign =
      stored.record.kind === "repeat-test"
        ? await assertRepeatWorkflowAccess(input.scope, runtime, stored, actorId)
        : undefined;
    const reconciled =
      stored.record.kind === "author-test"
        ? await reconcileAuthoring(input.scope, runtime, stored, actorId, at)
        : stored.record.kind === "repeat-test"
          ? await reconcileRepeat(input.scope, runtime, stored, actorId, at, repeatCampaign)
          : await reconcileRun(input.scope, runtime, stored, actorId, at);
    if ("job" in reconciled && reconciled.job) assertJobAccess(input.scope, reconciled.job);
    recordAudit(input.scope, {
      action: "workflow.read",
      resource: reconciled.workflow.record.workflowId,
      result: "allow",
    });
    json(input.response, 200, reconciled);
    return true;
  }

  const transitionMatch = matchPath(input.pathname, "/workflows/:workflowId/transitions");
  if (input.method === "POST" && transitionMatch) {
    const body = (await parseJsonBody(input.request)) as OperationInput<"workflow.transition">;
    const stored = await readDurableWorkflow({
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      workflowId: transitionMatch.workflowId!,
    });
    if (!stored) workflowNotFound();
    if (stored.record.kind === "author-test") {
      const frozen = jsonRecord(stored.record.frozenIdentity);
      if (!frozen || frozen.actorId !== actorId) workflowNotFound();
    }
    const repeatCampaign =
      stored.record.kind === "repeat-test"
        ? await assertRepeatWorkflowAccess(input.scope, runtime, stored, actorId)
        : undefined;
    const current = await expireIfNeeded(input.scope, stored, actorId, at);
    if (current.record.status === "expired") throw new HttpError(410, "Workflow expired");
    if (current.record.version !== body.expectedVersion) {
      throw new HttpError(409, "Workflow version changed", { workflow: current });
    }
    if (current.record.kind === "repeat-test") {
      const repeatActions = new Set([
        "reserve-repeat-pilot",
        "attach-repeat",
        "reserve-repeat-resume",
        "complete-repeat-resume",
        "reserve-repeat-cancel",
        "complete-repeat-cancel",
      ]);
      if (!repeatActions.has(body.action)) {
        throw new HttpError(409, "This transition does not apply to Repeat");
      }
      const result = await transitionRepeatWorkflow({
        scope: input.scope,
        runtime,
        workflow: current,
        body: body as RepeatWorkflowTransitionInput,
        actorId,
        at,
        ...(repeatCampaign ? { knownCampaign: repeatCampaign } : {}),
      });
      json(input.response, 200, result);
      return true;
    }
    if (current.record.kind === "author-test") {
      const finishDispatch = trackAuthoringDispatch(input.scope, current.record.workflowId);
      try {
        const frozen = jsonRecord(current.record.frozenIdentity);
        if (!frozen) workflowNotFound();
        if (body.action === "start-authoring") {
          if (current.record.resource || current.record.lastTransition !== "created") {
            throw new HttpError(409, "Authoring start has already been dispatched");
          }
          const target = jsonRecord(frozen.target);
          if (
            typeof frozen.workflowRequestId !== "string" ||
            typeof frozen.title !== "string" ||
            (frozen.originApplication !== undefined &&
              (typeof frozen.originApplication !== "string" || !frozen.originApplication.trim())) ||
            typeof frozen.appMapId !== "string" ||
            typeof frozen.appMapRevision !== "number" ||
            !Number.isSafeInteger(frozen.appMapRevision) ||
            !target ||
            (target.kind !== "device" && target.kind !== "browser") ||
            typeof target.platform !== "string" ||
            typeof target.targetId !== "string"
          ) {
            throw new HttpError(409, "Authoring workflow identity is invalid");
          }
          await runtime.assertAuthoringStartAccess(input.scope, target.targetId, body.leaseId);
          const reserved = await runtime.transitionWorkflow({
            organizationId: input.scope.organizationId,
            projectId: input.scope.projectId,
            workflowId: current.record.workflowId,
            expectedVersion: body.expectedVersion,
            actorId,
            transition: "start-authoring-requested",
            status: "active",
            at,
          });
          if (reserved.status !== "updated") {
            throw new HttpError(409, "Workflow version changed before Authoring began");
          }
          let session: AuthoringSession;
          try {
            session = await runtime.beginAuthoringSession(
              input.scope,
              {
                appMapId: frozen.appMapId,
                workflowRequestId: frozen.workflowRequestId,
                testName: frozen.title,
                ...(typeof frozen.originApplication === "string"
                  ? { originApplication: frozen.originApplication }
                  : {}),
                target: {
                  kind: target.kind,
                  platform: target.platform as "android" | "ios" | "browser",
                  targetId: target.targetId,
                  // A browser recording keeps the saved login it was started with.
                  ...(target.kind === "browser" &&
                  typeof target.authenticationFixtureId === "string" &&
                  target.authenticationFixtureId.trim()
                    ? { authenticationFixtureId: target.authenticationFixtureId.trim() }
                    : {}),
                } as CreateAuthoringSessionInput["target"],
                leaseId: body.leaseId,
                expectedAppMapRevision: frozen.appMapRevision,
                ...(typeof frozen.sourceScreenId === "string"
                  ? { sourceScreenId: frozen.sourceScreenId }
                  : {}),
                ...(typeof frozen.pendingConnectionId === "string"
                  ? { pendingConnectionId: frozen.pendingConnectionId }
                  : {}),
                ...(typeof frozen.group === "string" ? { group: frozen.group } : {}),
              },
              runtime.authoringRuntime,
            );
          } catch (error) {
            await runtime.transitionWorkflow({
              organizationId: input.scope.organizationId,
              projectId: input.scope.projectId,
              workflowId: current.record.workflowId,
              expectedVersion: reserved.workflow.record.version,
              actorId,
              transition: "start-authoring-outcome-unknown",
              status: "needs-attention",
              at: runtime.now(),
            });
            throw new HttpError(
              409,
              error instanceof Error ? error.message : "Authoring start outcome is unknown",
            );
          }
          if (!authoringIdentityFromSession(current.record, session)) {
            throw new HttpError(409, "Authoring start returned a different canonical session");
          }
          const attached = await runtime.transitionWorkflow({
            organizationId: input.scope.organizationId,
            projectId: input.scope.projectId,
            workflowId: current.record.workflowId,
            expectedVersion: reserved.workflow.record.version,
            actorId,
            transition: "authoring-started",
            status: authoringIsTerminal(session) ? "terminal" : "active",
            resource: { kind: "authoring-session", id: session.id },
            at: runtime.now(),
          });
          if (attached.status !== "updated") {
            throw new HttpError(409, "Authoring began but workflow reconciliation changed");
          }
          json(input.response, 200, { workflow: attached.workflow, session });
          return true;
        }
        if (body.action === "authoring-abandon") {
          const hasCanonicalSession = current.record.resource?.kind === "authoring-session";
          const unprovenStart =
            !hasCanonicalSession &&
            (current.record.lastTransition === "start-authoring-requested" ||
              current.record.lastTransition === "start-authoring-outcome-unknown");
          const unresolvedWithoutSession =
            !hasCanonicalSession && current.record.status === "needs-attention";
          if (!unprovenStart && !unresolvedWithoutSession) {
            throw new HttpError(
              409,
              "Authoring can be abandoned only when no canonical session can be safely continued",
            );
          }
          const abandoned = await runtime.transitionWorkflow({
            organizationId: input.scope.organizationId,
            projectId: input.scope.projectId,
            workflowId: current.record.workflowId,
            expectedVersion: body.expectedVersion,
            actorId,
            transition: "authoring-abandoned",
            status: "terminal",
            ...(current.record.resource ? { resource: current.record.resource } : {}),
            resolution: { kind: "abandoned", reason: body.reason, at },
            at,
          });
          if (abandoned.status !== "updated") {
            throw new HttpError(409, "Workflow version changed before Authoring was abandoned");
          }
          const session =
            current.record.resource?.kind === "authoring-session"
              ? await runtime.getAuthoringSession(current.record.resource.id).catch(() => undefined)
              : undefined;
          recordAudit(input.scope, {
            action: "workflow.authoring.abandon",
            resource: current.record.workflowId,
            result: "allow",
          });
          json(input.response, 200, {
            workflow: abandoned.workflow,
            ...(session ? { session } : {}),
          });
          return true;
        }
        if (body.action === "attach-run" || body.action === "cancel-run") {
          throw new HttpError(409, "This transition does not apply to Authoring");
        }
        if (current.record.status === "terminal") {
          throw new HttpError(409, "This Authoring workflow is already finished");
        }
        const resource = current.record.resource;
        if (resource?.kind !== "authoring-session") {
          throw new HttpError(409, "Authoring workflow has no proven canonical session");
        }
        const session = await runtime.getAuthoringSession(resource.id).catch(() => undefined);
        if (!session || !authoringIdentityFromSession(current.record, session)) workflowNotFound();
        if (
          current.record.status === "needs-attention" ||
          current.record.lastTransition.endsWith("-requested") ||
          current.record.lastTransition.endsWith("-outcome-unknown")
        ) {
          throw new HttpError(409, "Authoring outcome requires inspection; it will not be retried");
        }
        if (!authoringActionIsAllowed(session, body.action)) {
          throw new HttpError(409, `Authoring action is not allowed while ${session.state}`);
        }
        await runtime.assertAuthoringAccess(input.scope, session, body.action);
        const reserved = await runtime.transitionWorkflow({
          organizationId: input.scope.organizationId,
          projectId: input.scope.projectId,
          workflowId: current.record.workflowId,
          expectedVersion: body.expectedVersion,
          actorId,
          transition: `${body.action}-requested`,
          status: "active",
          resource,
          at,
        });
        if (reserved.status !== "updated") {
          throw new HttpError(409, "Workflow version changed before Authoring mutation");
        }
        const recordInteraction = body.action === "authoring-record" ? body.interaction : undefined;
        let next: AuthoringSession;
        try {
          next = await runtime.transitionAuthoringSession(
            input.scope,
            session.id,
            body,
            runtime.authoringRuntime,
            {
              workflowId: current.record.workflowId,
              transitionVersion: reserved.workflow.record.version,
              action: body.action,
              completedAt: runtime.now(),
            },
          );
        } catch (error) {
          const failedSession = recordInteraction
            ? await runtime.getAuthoringSession(session.id).catch(() => undefined)
            : undefined;
          if (
            failedSession &&
            recordInteraction &&
            authoringIdentityFromSession(current.record, failedSession) &&
            authoringRecordFailureIsProven(session, failedSession, recordInteraction)
          ) {
            const failed = await runtime.transitionWorkflow({
              organizationId: input.scope.organizationId,
              projectId: input.scope.projectId,
              workflowId: current.record.workflowId,
              expectedVersion: reserved.workflow.record.version,
              actorId,
              transition: `${body.action}-failed`,
              status: "active",
              resource,
              at: runtime.now(),
            });
            if (failed.status !== "updated") {
              throw new HttpError(
                409,
                "Authoring interaction failed but workflow reconciliation changed",
              );
            }
            throw new HttpError(
              422,
              error instanceof Error ? error.message : "The target interaction failed",
              {
                code:
                  error instanceof InputNotDispatchedError
                    ? "input-not-dispatched"
                    : "AUTHORING_INTERACTION_FAILED",
                ...(error instanceof InputNotDispatchedError ? { dispatched: false } : {}),
                workflow: failed.workflow,
                session: failedSession,
              },
            );
          }
          await runtime.transitionWorkflow({
            organizationId: input.scope.organizationId,
            projectId: input.scope.projectId,
            workflowId: current.record.workflowId,
            expectedVersion: reserved.workflow.record.version,
            actorId,
            transition: `${body.action}-outcome-unknown`,
            status: "needs-attention",
            resource,
            at: runtime.now(),
          });
          throw new HttpError(
            409,
            error instanceof Error ? error.message : "Authoring mutation outcome is unknown",
          );
        }
        if (
          !authoringIdentityAfterMutation(current.record, next, {
            action: body.action,
            transitionVersion: reserved.workflow.record.version,
          })
        ) {
          throw new HttpError(409, "Authoring mutation returned a different canonical session");
        }
        const committed = await runtime.transitionWorkflow({
          organizationId: input.scope.organizationId,
          projectId: input.scope.projectId,
          workflowId: current.record.workflowId,
          expectedVersion: reserved.workflow.record.version,
          actorId,
          transition: `${body.action}-completed`,
          status: authoringIsTerminal(next) ? "terminal" : "active",
          resource,
          at: runtime.now(),
        });
        if (committed.status !== "updated") {
          throw new HttpError(
            409,
            "Authoring mutation completed but workflow reconciliation changed",
          );
        }
        json(input.response, 200, { workflow: committed.workflow, session: next });
        return true;
      } finally {
        finishDispatch();
      }
    }
    if (current.record.kind !== "run-test") {
      throw new HttpError(409, "This workflow kind is not supported yet");
    }

    if (body.action === "abandon-run") {
      if (
        current.record.status !== "active" ||
        current.record.lastTransition !== "created" ||
        current.record.resource
      ) {
        throw new HttpError(409, "Only an unattached Run reservation can be abandoned");
      }
      const abandoned = await transitionDurableWorkflow({
        organizationId: input.scope.organizationId,
        projectId: input.scope.projectId,
        workflowId: current.record.workflowId,
        expectedVersion: body.expectedVersion,
        actorId,
        transition: "run-abandoned",
        status: "terminal",
        resolution: { kind: "abandoned", reason: body.reason!, at },
        at,
      });
      if (abandoned.status !== "updated")
        throw new HttpError(409, "Workflow version changed", {
          workflow: "current" in abandoned ? abandoned.current : undefined,
        });
      recordAudit(input.scope, {
        action: "workflow.transition",
        resource: current.record.workflowId,
        result: "allow",
      });
      json(input.response, 200, { workflow: abandoned.workflow });
      return true;
    }

    if (body.action === "attach-run") {
      const job = runtime.getJob(body.jobId!);
      assertJobAccess(input.scope, job);
      const frozenIdentity = job ? runIdentityFromJob(current.record, job) : undefined;
      if (!job || !frozenIdentity) throw new HttpError(409, "Job does not match this workflow");
      const attached = await transitionDurableWorkflow({
        organizationId: input.scope.organizationId,
        projectId: input.scope.projectId,
        workflowId: current.record.workflowId,
        expectedVersion: body.expectedVersion,
        actorId,
        transition: "run-attached",
        status: terminalJobStatuses.has(job.status) ? "terminal" : "active",
        resource: { kind: "job", id: job.id },
        frozenIdentity,
        at,
      });
      if (attached.status !== "updated") {
        throw new HttpError(409, "Workflow version changed", {
          workflow: "current" in attached ? attached.current : undefined,
        });
      }
      json(input.response, 200, { workflow: attached.workflow, job });
      return true;
    }

    const job = scopedJob(input.scope, runtime, current);
    if (!job) {
      const reconciled = await reconcileRun(input.scope, runtime, current, actorId, at);
      throw new HttpError(409, "Workflow has no uniquely proven Run to cancel", {
        workflow: reconciled.workflow,
      });
    }
    assertJobAccess(input.scope, job);
    if (
      current.record.status === "needs-attention" ||
      current.record.lastTransition === "cancel-requested" ||
      current.record.lastTransition === "cancel-outcome-unknown"
    ) {
      const reconciled = await reconcileRun(input.scope, runtime, current, actorId, at);
      if (reconciled.workflow.record.status === "terminal") {
        json(input.response, 200, reconciled);
        return true;
      }
      throw new HttpError(409, "Cancellation outcome requires inspection; it will not be retried", {
        workflow: reconciled.workflow,
      });
    }
    if (terminalJobStatuses.has(job.status)) {
      const reconciled = await reconcileRun(input.scope, runtime, current, actorId, at);
      json(input.response, 200, reconciled);
      return true;
    }
    const targetId = job.browserTargetId ?? job.serial;
    if (!targetId) throw new HttpError(409, "Run target is unavailable for cancellation");
    await runtime.assertTargetControl(input.scope, targetId);
    const reserved = await transitionDurableWorkflow({
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      workflowId: current.record.workflowId,
      expectedVersion: body.expectedVersion,
      actorId,
      transition: "cancel-requested",
      status: "active",
      resource: { kind: "job", id: job.id },
      at,
    });
    if (reserved.status !== "updated") {
      throw new HttpError(409, "Workflow version changed before cancellation");
    }
    let cancelled: TestJob;
    try {
      cancelled = runtime.cancelJob(job.id);
    } catch (error) {
      await transitionDurableWorkflow({
        organizationId: input.scope.organizationId,
        projectId: input.scope.projectId,
        workflowId: current.record.workflowId,
        expectedVersion: reserved.workflow.record.version,
        actorId,
        transition: "cancel-outcome-unknown",
        status: "needs-attention",
        resource: { kind: "job", id: job.id },
        at: runtime.now(),
      });
      throw new HttpError(
        409,
        error instanceof Error ? error.message : "Cancellation outcome is unknown",
      );
    }
    const committed = await transitionDurableWorkflow({
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      workflowId: current.record.workflowId,
      expectedVersion: reserved.workflow.record.version,
      actorId,
      transition: "run-cancelled",
      status: terminalJobStatuses.has(cancelled.status) ? "terminal" : "needs-attention",
      resource: { kind: "job", id: cancelled.id },
      frozenIdentity: runIdentityFromJob(current.record, cancelled),
      at: runtime.now(),
    });
    if (committed.status !== "updated") {
      throw new HttpError(409, "Cancellation completed but workflow reconciliation changed");
    }
    recordAudit(input.scope, {
      action: "workflow.cancel",
      resource: current.record.workflowId,
      result: "allow",
    });
    json(input.response, 200, { workflow: committed.workflow, job: cancelled });
    return true;
  }
  return false;
}
