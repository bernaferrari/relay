export type InvestigationOriginalEnvironment = {
  runId: string;
  targetName?: string;
  targetProfileId?: string;
  buildId?: string;
  browser?: string;
  sourceRevision?: string;
  appVersion?: string;
};

export type InvestigationCandidate = {
  id: string;
  serial: string;
  name: string;
  runnable: boolean;
};

export type InvestigationReproduction =
  | { kind: "unbound" }
  | { kind: "resolving"; original: InvestigationOriginalEnvironment }
  | {
      kind: "restoring-original";
      original: InvestigationOriginalEnvironment;
      device: InvestigationCandidate;
    }
  | { kind: "original-unavailable"; original: InvestigationOriginalEnvironment }
  | {
      kind: "substituted";
      original: InvestigationOriginalEnvironment;
      device: InvestigationCandidate;
      reason: "original-unavailable" | "explicit-choice";
    };

/** Match the original identity only. Duplicate display names never pick a device. */
export function matchOriginalInvestigationDevice(
  devices: readonly InvestigationCandidate[],
  original: InvestigationOriginalEnvironment,
): InvestigationCandidate | undefined {
  const profileId = original.targetProfileId?.trim();
  if (profileId) {
    const byIdentity = devices.filter(
      (device) => device.serial === profileId || device.id === profileId,
    );
    return byIdentity.length === 1 ? byIdentity[0] : undefined;
  }
  const name = original.targetName?.trim();
  if (!name) return undefined;
  const byName = devices.filter((device) => device.name === name);
  return byName.length === 1 ? byName[0] : undefined;
}

export function classifyInvestigationReproduction(input: {
  original?: InvestigationOriginalEnvironment;
  devices?: readonly InvestigationCandidate[];
  devicesPending: boolean;
  selectedSerial: string;
}): InvestigationReproduction {
  if (!input.original) return { kind: "unbound" };
  if (input.devicesPending || input.devices === undefined) {
    return { kind: "resolving", original: input.original };
  }

  const originalDevice = matchOriginalInvestigationDevice(input.devices, input.original);
  const selected = input.devices.find(
    (device) => device.serial === input.selectedSerial && device.runnable,
  );

  if (originalDevice?.runnable) {
    if (!selected || selected.serial === originalDevice.serial) {
      return {
        kind: "restoring-original",
        original: input.original,
        device: originalDevice,
      };
    }
    return {
      kind: "substituted",
      original: input.original,
      device: selected,
      reason: "explicit-choice",
    };
  }

  if (selected) {
    return {
      kind: "substituted",
      original: input.original,
      device: selected,
      reason: "original-unavailable",
    };
  }
  return { kind: "original-unavailable", original: input.original };
}

export function originalEnvironmentSummary(original: InvestigationOriginalEnvironment): string {
  return (
    [
      original.targetName,
      original.browser,
      original.buildId ? `Build ${original.buildId}` : undefined,
      original.sourceRevision ? `revision ${original.sourceRevision}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || "Configuration from this result"
  );
}

export function investigationReproductionCopy(state: InvestigationReproduction): {
  title: string;
  detail: string;
  startLabel: string;
  autoStart: boolean;
} {
  if (state.kind === "resolving") {
    return {
      title: "Reproduction environment",
      detail: "Restoring original configuration…",
      startLabel: "Start investigation",
      autoStart: false,
    };
  }
  if (state.kind === "restoring-original") {
    return {
      title: "Reproduction environment",
      detail: "Restoring original configuration…",
      startLabel: "Start investigation",
      autoStart: true,
    };
  }
  if (state.kind === "original-unavailable") {
    return {
      title: "Original device unavailable",
      detail:
        "Choose a ready device. That starts a new experiment, not a reproduction of the original result.",
      startLabel: "Start new experiment",
      autoStart: false,
    };
  }
  if (state.kind === "substituted") {
    return {
      title: `Investigating on ${state.device.name} instead`,
      detail: "This is a new experiment. The original result stays unchanged.",
      startLabel: "Start new experiment",
      autoStart: false,
    };
  }
  return {
    title: "Reproduction environment",
    detail: "Choose a ready device or browser.",
    startLabel: "Start investigation",
    autoStart: false,
  };
}

export function investigationConfigRefs(
  original: InvestigationOriginalEnvironment | undefined,
  reproduction: InvestigationReproduction,
): string[] {
  const refs = original
    ? Object.entries({
        targetProfileId: original.targetProfileId,
        buildId: original.buildId,
        browser: original.browser,
        sourceRevision: original.sourceRevision,
        appVersion: original.appVersion,
      })
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([key, value]) => `${key}:${value}`)
    : [];
  if (reproduction.kind === "restoring-original") refs.push("reproduction:original");
  if (reproduction.kind === "substituted") refs.push("reproduction:substituted");
  return refs.slice(0, 64);
}
