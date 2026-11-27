import {
  createRelayOperationPort,
  type RelayInvokeClient,
  type RelayOperationPort,
} from "./operation-port.js";
import { CanonicalAuthoringWorkflow } from "./authoring-workflow.js";
import { CanonicalRepeatWorkflow } from "./repeat-workflow.js";
import { CanonicalRunWorkflow } from "./run-workflow.js";
import type {
  AuthorTestDecision,
  AuthorTestIntent,
  AuthorTestRecoveryIntent,
  AuthorTestSnapshot,
  DurableAuthorTestDecision,
  DurableRepeatTestDecision,
  DurableWorkflowHandle,
  RepeatTestDecision,
  RepeatTestIntent,
  RepeatTestRecoveryIntent,
  RepeatTestSnapshot,
  RunTestIntent,
  RunTestRecoveryIntent,
  RunTestSnapshot,
  RelayWorkflows,
  WorkflowDecision,
  WorkflowIntent,
  WorkflowRecoveryIntent,
  WorkflowRef,
  WorkflowSnapshot,
} from "./types.js";
import {
  decodeAuthoringWorkflowRef,
  decodeRepeatWorkflowRef,
  decodeRunWorkflowRef,
} from "./workflow-ref.js";
import { invalidRefSnapshot } from "./invalid-workflow-snapshot.js";
import { unavailableDurableRun } from "./run-workflow-support.js";
import { unavailableWorkflowProblem as unavailableProblem } from "./workflow-problems.js";

class CanonicalRelayWorkflows implements RelayWorkflows {
  private readonly authoring: CanonicalAuthoringWorkflow;
  private readonly repeat: CanonicalRepeatWorkflow;
  private readonly run: CanonicalRunWorkflow;

  constructor(private readonly operations: RelayOperationPort) {
    this.authoring = new CanonicalAuthoringWorkflow(operations);
    this.repeat = new CanonicalRepeatWorkflow(operations);
    this.run = new CanonicalRunWorkflow(operations);
  }

  async start(intent: RunTestIntent): Promise<RunTestSnapshot>;
  async start(intent: AuthorTestIntent): Promise<AuthorTestSnapshot>;
  async start(intent: RepeatTestIntent): Promise<RepeatTestSnapshot>;
  async start(intent: WorkflowIntent): Promise<WorkflowSnapshot> {
    if (intent.kind === "author-test") return this.authoring.start(intent);
    if (intent.kind === "repeat-test") return this.repeat.start(intent);
    return this.run.start(intent);
  }

  async recover(intent: AuthorTestRecoveryIntent): Promise<AuthorTestSnapshot>;
  async recover(intent: RepeatTestRecoveryIntent): Promise<RepeatTestSnapshot>;
  async recover(intent: RunTestRecoveryIntent): Promise<RunTestSnapshot>;
  async recover(intent: WorkflowRecoveryIntent): Promise<WorkflowSnapshot> {
    if (intent.kind === "run-test") return this.run.recover(intent);
    return intent.kind === "author-test"
      ? this.authoring.recover(intent)
      : this.repeat.recover(intent);
  }

  async inspect(ref: WorkflowRef): Promise<WorkflowSnapshot> {
    const repeatReference = decodeRepeatWorkflowRef(ref);
    if (repeatReference) return this.repeat.inspect(ref, repeatReference);
    const authoringReference = decodeAuthoringWorkflowRef(ref);
    if (authoringReference) return this.authoring.inspect(ref, authoringReference);
    const reference = decodeRunWorkflowRef(ref);
    if (!reference) return invalidRefSnapshot(ref);
    return this.run.inspect(ref, reference);
  }

  async inspectRun(workflowId: string): Promise<RunTestSnapshot> {
    return this.run.inspectRun(workflowId);
  }

  async inspectDurable(
    workflowId: string,
  ): Promise<RunTestSnapshot | AuthorTestSnapshot | RepeatTestSnapshot> {
    try {
      const output = await this.operations.invoke("workflow.get", { workflowId });
      if (output.workflow.record.kind === "author-test") {
        return this.authoring.snapshotDurable(output);
      }
      if (output.workflow.record.kind === "repeat-test") {
        return this.repeat.inspectDurable(workflowId);
      }
      return this.run.snapshotDurable(output);
    } catch (error) {
      return unavailableDurableRun({
        workflow: { workflowId, expectedVersion: 1 },
        problem: unavailableProblem("inspect the durable workflow", error),
      });
    }
  }

  inspectAuthoring(workflowId: string): Promise<AuthorTestSnapshot> {
    return this.authoring.inspectDurable(workflowId);
  }

  inspectRepeat(workflowId: string) {
    return this.repeat.inspectDurable(workflowId);
  }

  advanceAuthoring(decision: DurableAuthorTestDecision) {
    return this.authoring.advanceDurable(decision);
  }

  advanceRepeat(decision: DurableRepeatTestDecision) {
    return this.repeat.advanceDurable(decision);
  }

  async cancelRun(input: DurableWorkflowHandle): Promise<RunTestSnapshot> {
    return this.run.cancelRun(input);
  }

  async advance(decision: WorkflowDecision): Promise<WorkflowSnapshot> {
    const repeatReference = decodeRepeatWorkflowRef(decision.ref);
    if (repeatReference) {
      return this.repeat.adoptAndAdvance(decision as RepeatTestDecision, repeatReference);
    }
    const authoringReference = decodeAuthoringWorkflowRef(decision.ref);
    if (authoringReference) {
      return this.authoring.advance(decision as AuthorTestDecision, authoringReference);
    }
    const reference = decodeRunWorkflowRef(decision.ref);
    if (!reference) return invalidRefSnapshot(decision.ref);
    return this.run.advance(decision, reference);
  }
}

export function createRelayWorkflows(client: RelayInvokeClient): RelayWorkflows {
  return new CanonicalRelayWorkflows(createRelayOperationPort(client));
}
