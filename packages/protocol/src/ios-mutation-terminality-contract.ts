/**
 * Executable contract for recovery boundaries around an ambiguous iOS command.
 *
 * A native command with an unknown acknowledgement is not an ordinary failure:
 * callers must stop after that command and surface review evidence.  This
 * small, dependency-free test helper lets core, server, and renderer suites
 * register their public recovery boundaries in the same shape without trying
 * to infer coverage from source text.
 */

export type IosMutationTerminalityTrace = {
  /**
   * Native commands (or the one transport command that owns a native command)
   * issued by the boundary under test. Read-only evidence capture does not
   * belong here.
   */
  nativeDispatches: readonly string[];
  /** What the boundary did with the observed outcome. */
  status: "terminal" | "recovered" | "handled";
  /** The original ambiguous outcome for terminal scenarios. */
  error?: unknown;
};

export type IosMutationTerminalityRecovery = {
  /** The intentional non-ambiguous behavior of this recovery boundary. */
  expectedStatus: "recovered" | "handled";
  /**
   * Exact command count makes a fallback deliberate. For example, a proven
   * selector miss may legitimately be two commands; a handled optional error
   * may be one.
   */
  expectedNativeDispatches: number;
  run: () => Promise<IosMutationTerminalityTrace>;
};

export type IosMutationTerminalitySurface = {
  /** Stable public boundary identifier, e.g. `core.recipe.screen-recovery`. */
  id: string;
  /**
   * Exercise an IOS_MUTATION_OUTCOME_UNKNOWN from the physical command.
   * This must return the original error rather than allowing a second command.
   */
  unknown: () => Promise<IosMutationTerminalityTrace>;
  /**
   * Every registered boundary also states what its ordinary error/selector
   * miss still does, so terminality tests cannot accidentally erase useful
   * recovery behavior.
   */
  recovery: IosMutationTerminalityRecovery;
};

export type IosMutationTerminalityRegistry = readonly IosMutationTerminalitySurface[];

/**
 * Declare a composed terminality suite. This deliberately validates only the
 * registry's explicit shape and unique public names; behavior is proven by
 * {@link verifyIosMutationTerminalityRegistry}, not a brittle source scan.
 */
export function defineIosMutationTerminalityRegistry<
  const Surfaces extends IosMutationTerminalityRegistry,
>(surfaces: Surfaces): Surfaces {
  const ids = new Set<string>();
  for (const surface of surfaces) {
    const id = surface.id.trim();
    if (!id) throw new Error("iOS mutation terminality surfaces need a non-empty id");
    if (ids.has(id)) throw new Error(`duplicate iOS mutation terminality surface: ${id}`);
    if (!Number.isInteger(surface.recovery.expectedNativeDispatches)) {
      throw new Error(`${id}: recovery expectedNativeDispatches must be an integer`);
    }
    if (surface.recovery.expectedNativeDispatches < 0) {
      throw new Error(`${id}: recovery expectedNativeDispatches cannot be negative`);
    }
    ids.add(id);
  }
  return surfaces;
}

export type IosMutationTerminalityVerifier = {
  /** Package-specific predicate: core uses the typed Error, UI uses its HTTP payload. */
  isOutcomeUnknown: (error: unknown) => boolean;
};

function describeDispatches(dispatches: readonly string[]): string {
  return dispatches.length ? dispatches.join(", ") : "none";
}

/**
 * Run each declared public boundary serially. Serial execution is intentional:
 * the boundaries often use singleton fake target contexts, just like the real
 * device lane. A terminal trace must contain the original unknown error and
 * precisely one command, while the declared ordinary path must retain its
 * reviewed behavior.
 */
export async function verifyIosMutationTerminalityRegistry(
  registry: IosMutationTerminalityRegistry,
  verifier: IosMutationTerminalityVerifier,
): Promise<void> {
  for (const surface of registry) {
    const unknown = await surface.unknown();
    if (unknown.status !== "terminal") {
      throw new Error(`${surface.id}: unknown iOS outcome was ${unknown.status}, not terminal`);
    }
    if (!verifier.isOutcomeUnknown(unknown.error)) {
      throw new Error(`${surface.id}: terminal trace did not retain IOS_MUTATION_OUTCOME_UNKNOWN`);
    }
    if (unknown.nativeDispatches.length !== 1) {
      throw new Error(
        `${surface.id}: unknown iOS outcome issued ${unknown.nativeDispatches.length} native commands ` +
          `(${describeDispatches(unknown.nativeDispatches)}); expected exactly one`,
      );
    }

    const recovery = await surface.recovery.run();
    if (recovery.status !== surface.recovery.expectedStatus) {
      throw new Error(
        `${surface.id}: ordinary recovery was ${recovery.status}; expected ${surface.recovery.expectedStatus}`,
      );
    }
    if (recovery.error !== undefined) {
      const message =
        recovery.error instanceof Error ? recovery.error.message : String(recovery.error);
      throw new Error(
        `${surface.id}: ordinary recovery unexpectedly retained an error: ${message}`,
      );
    }
    if (recovery.nativeDispatches.length !== surface.recovery.expectedNativeDispatches) {
      throw new Error(
        `${surface.id}: ordinary recovery issued ${recovery.nativeDispatches.length} native commands ` +
          `(${describeDispatches(recovery.nativeDispatches)}); expected ${surface.recovery.expectedNativeDispatches}`,
      );
    }
  }
}
