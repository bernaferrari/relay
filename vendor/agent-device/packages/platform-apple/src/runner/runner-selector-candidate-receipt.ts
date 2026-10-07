import type { RunnerCommand } from './runner-contract.ts';

/** Observe the same options as Relay's native named tap without preparing or activating an app. */
export function buildSelectorCandidateReceiptRequest(
  appBundleId: string,
  selectorKey: 'id' | 'label',
  selectorValue: string,
): RunnerCommand {
  return {
    command: 'querySelectorTapCandidate',
    appBundleId,
    selectorKey,
    selectorValue,
    allowNonHittableCoordinateFallback: true,
    timeoutMs: 15_000,
  };
}
