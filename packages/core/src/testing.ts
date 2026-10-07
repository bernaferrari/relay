import type { Device } from "./device-capabilities.js";
import { createDeviceObservationFacade } from "./device-observation-membrane.js";

// Cross-package recording regressions exercise the canonical lifecycle and
// listener boundary without importing private source files or contacting iOS.
export { recordAuthoringInteraction } from "./authoring-recording-lifecycle.js";
export { runWithIosSupervisionMode } from "./ios-mutation-policy.js";
export {
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommand,
} from "./ios-runner-listener-command.js";

/**
 * Make an intentional structural device double for a test.
 *
 * This lives at the explicit `@relay/core/testing` package entrypoint so
 * production workflows do not accidentally import an injection helper. The
 * The result is a fresh public observation facade, not the fake transport
 * itself. A test that needs to inspect a raw spy should keep that fake
 * separately, while canonical helpers still dispatch through the registered
 * private source.
 *
 * It is a testing ergonomic boundary, not a runtime security mechanism.
 * TypeScript cannot stop a repository author from using `as unknown as Device`
 * or constructing a non-literal dynamic import. Package exports and the
 * architecture check instead make those deliberate escapes visible in review.
 */
export function deviceTestDouble<T extends object>(capabilities: T): Device {
  return createDeviceObservationFacade(capabilities);
}
