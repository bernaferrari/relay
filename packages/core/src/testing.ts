import type { Device } from "./device-capabilities.js";

/**
 * Make an intentional structural device double for a test.
 *
 * This lives at the explicit `@relay/core/testing` package entrypoint so
 * production workflows do not accidentally import an injection helper. The
 * result remains typed as the public observation facade; a test that needs to
 * inspect its own fake's raw spy should keep that spy separately.
 *
 * It is a testing ergonomic boundary, not a runtime security mechanism.
 * TypeScript cannot stop a repository author from using `as unknown as Device`
 * or constructing a non-literal dynamic import. Package exports and the
 * architecture check instead make those deliberate escapes visible in review.
 */
export function deviceTestDouble<T extends object>(capabilities: T): Device {
  return capabilities as unknown as Device;
}
