import type { RunnerCommand } from './runner-contract.ts';

/** Window-only admission observation; the runner refuses unavailable foreground proof. */
export function buildApplicationWindowBoundsRequest(
  appBundleId: string,
): RunnerCommand & { command: 'appWindowBounds'; appBundleId: string } {
  return { command: 'appWindowBounds', appBundleId };
}
