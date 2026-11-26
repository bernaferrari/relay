const LEGACY_POSITIONAL_BROWSER_REF = /^@?browser-\d+$/u;

/** Historical browser snapshots numbered DOM nodes by capture order. Those
 * refs are observations, not replayable identity, because ordinary DOM edits
 * can make the same number point at a different control. */
export function isLegacyPositionalBrowserRef(ref: string | undefined): boolean {
  return Boolean(ref?.trim().match(LEGACY_POSITIONAL_BROWSER_REF));
}

export const LEGACY_POSITIONAL_BROWSER_REF_ERROR =
  "Legacy positional browser refs cannot be replayed safely; re-record with an identifier or label";
