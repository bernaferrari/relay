import type { OperationRecord } from "./operation-contract.js";

type RunParserDependencies = {
  fail(label: string, message: string): never;
  record(value: unknown, label: string): OperationRecord;
  string(value: unknown, label: string): string;
};

/** Validate the target and Variable fields shared by Connection and Flow runs. */
export function validateAppMapRunInput(
  input: OperationRecord,
  dependencies: RunParserDependencies,
  label: string,
): void {
  const { fail, record, string } = dependencies;
  if (input.serial !== undefined) string(input.serial, `${label} serial`);
  if (input.browserTargetId !== undefined) {
    string(input.browserTargetId, `${label} browserTargetId`);
  }
  if (input.platform !== undefined && input.platform !== "android" && input.platform !== "ios") {
    fail(`${label} platform`, "must be android or ios");
  }
  if (
    input.targetKind !== undefined &&
    input.targetKind !== "device" &&
    input.targetKind !== "browser"
  ) {
    fail(`${label} targetKind`, "must be device or browser");
  }
  if (input.variables === undefined) return;
  for (const [name, value] of Object.entries(record(input.variables, "App Map variables"))) {
    if (Array.isArray(value)) {
      value.forEach((item) => string(item, `App Map variable ${name}`));
    } else {
      string(value, `App Map variable ${name}`);
    }
  }
}
