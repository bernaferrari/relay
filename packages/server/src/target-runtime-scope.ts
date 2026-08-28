/** Request-local target runtime ownership with one durable supervisor per target. */
import {
  runWithTargetDriverRegistry,
  runWithTargetSupervisorStore,
  TargetSupervisorStore,
  type TargetDriverRegistry,
} from "@relay/core";

export type TargetRuntimeScope = {
  run<T>(operation: () => T): T;
  close(): void;
};

export function createTargetRuntimeScope(registry: TargetDriverRegistry): TargetRuntimeScope {
  const supervisors = new TargetSupervisorStore();
  return {
    run: (operation) =>
      runWithTargetSupervisorStore(supervisors, () =>
        runWithTargetDriverRegistry(registry, operation),
      ),
    close: () => supervisors.close(),
  };
}
