import type { DatabaseSync } from "node:sqlite";
import type {
  DurableWorkflowKind,
  DurableWorkflowRecord,
  DurableWorkflowResourceRef,
} from "@relay/protocol";
import { parseRowDocument } from "./collaboration-db.js";

/** Read durable workflows whose canonical resource belongs to the requested scope. */
export function workflowRecordsByResources(
  db: DatabaseSync,
  organizationId: string,
  projectId: string,
  workflowKind: DurableWorkflowKind,
  resourceKind: DurableWorkflowResourceRef["kind"],
  resourceIds: readonly string[],
): DurableWorkflowRecord[] {
  const wanted = new Set(resourceIds);
  return (
    db
      .prepare(
        "SELECT document FROM workflow_records WHERE organization_id = ? AND project_id = ? AND kind = ?",
      )
      .all(organizationId, projectId, workflowKind) as Array<{ document?: string }>
  )
    .map((row) => parseRowDocument<DurableWorkflowRecord>(row))
    .filter((record): record is DurableWorkflowRecord => {
      const resource = record?.resource;
      return resource?.kind === resourceKind && wanted.has(resource.id);
    });
}
