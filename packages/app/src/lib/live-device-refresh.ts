/**
 * Refresh live pixels and semantics without competing for the physical iOS
 * XCTest command channel. Android may obtain both observations concurrently;
 * an iPad must finish the pixel read before Relay asks XCTest for its tree.
 */
export async function refreshLiveDeviceEvidence(input: {
  physicalIos: boolean;
  pollFrame: () => Promise<void>;
  pollSnapshot: () => Promise<void>;
}): Promise<void> {
  if (input.physicalIos) {
    await input.pollFrame();
    await input.pollSnapshot();
    return;
  }
  await Promise.all([input.pollFrame(), input.pollSnapshot()]);
}
