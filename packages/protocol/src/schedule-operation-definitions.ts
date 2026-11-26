import { createSchemaOperationBuilders } from "./operation/operation-builders.js";

type ScheduleOperationId =
  | "schedule.occurrences"
  | "schedule.list"
  | "schedule.create"
  | "schedule.delete"
  | "matrix.list"
  | "matrix.create"
  | "matrix.update"
  | "matrix.delete"
  | "matrix.import"
  | "matrix.resolve";
const { command, query } = createSchemaOperationBuilders<ScheduleOperationId>();

export const scheduleOperationDefinitions = [
  query("schedule.occurrences", "List scheduled occurrences", "/schedules/:scheduleId/occurrences"),
  query("schedule.list", "List schedules", "/schedules"),
  command("schedule.create", "Create schedule", "POST", "/schedules"),
  command("schedule.delete", "Delete schedule", "DELETE", "/schedules/:scheduleId"),
  query("matrix.list", "List compatibility matrices", "/matrices"),
  command("matrix.create", "Create compatibility matrix", "POST", "/matrices"),
  command("matrix.update", "Update compatibility matrix", "PUT", "/matrices/:matrixId"),
  command("matrix.delete", "Delete compatibility matrix", "DELETE", "/matrices/:matrixId"),
  command("matrix.import", "Import compatibility matrix", "POST", "/matrices/import"),
  command("matrix.resolve", "Resolve compatibility matrix", "POST", "/matrices/:matrixId/resolve", {
    idempotency: "inherent",
  }),
] as const;
