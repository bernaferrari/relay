/**
 * Pixels and semantic accessibility are independent whenever go-ios owns the
 * preview transport. Only the explicit XCTest PNG fallback shares the same
 * command channel as an iOS snapshot and must be serialized. Keeping this as
 * a transport fact—not a platform check—prevents an unavailable tree from
 * stalling otherwise healthy iPad pixels.
 */
export async function refreshLiveDeviceEvidence(input: {
  /** True only when this *specific* frame request uses XCTest. */
  frameSharesSemanticSession?: boolean;
  /** @deprecated Compatibility input for callers not yet transport-aware. */
  physicalIos?: boolean;
  pollFrame: () => Promise<void>;
  pollSnapshot: () => Promise<void>;
}): Promise<void> {
  if (input.frameSharesSemanticSession ?? input.physicalIos ?? false) {
    await input.pollFrame();
    await input.pollSnapshot();
    return;
  }
  await Promise.all([input.pollFrame(), input.pollSnapshot()]);
}
