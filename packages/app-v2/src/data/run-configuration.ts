export type RunConfigurationValue = {
  sourceRevision?: string;
  buildId?: string;
  targetProfileId?: string;
  targetName?: string;
  accountId?: string;
  accountName?: string;
  browserProfile?: string;
  dataSetId?: string;
  dataSetName?: string;
};

export type RunConfigurationBlocker = { id: string; label: string; detail?: string };
export type RunConfigurationOption = { id: string; label: string; detail?: string };
export type RunConfigurationSelection = {
  targetProfileIds?: readonly string[];
  targetProfileId?: string;
  dataSetIds?: readonly string[];
};
export type RunConfigurationState = {
  values: RunConfigurationValue;
  blockers?: readonly RunConfigurationBlocker[];
  frozen?: boolean;
  validated?: boolean;
};

export type RunConfigurationStorage = Pick<Storage, "getItem" | "setItem">;

export function readSavedRunConfiguration(
  storage: RunConfigurationStorage | undefined,
  key: string,
): RunConfigurationSelection {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const value = JSON.parse(raw) as { targetProfileId?: unknown; dataSetIds?: unknown };
    return {
      ...(typeof value.targetProfileId === "string"
        ? { targetProfileId: value.targetProfileId }
        : {}),
      ...(Array.isArray(value.dataSetIds)
        ? { dataSetIds: value.dataSetIds.filter((id): id is string => typeof id === "string") }
        : {}),
    };
  } catch {
    return {};
  }
}

export function saveRunConfiguration(
  storage: RunConfigurationStorage | undefined,
  key: string,
  selection: RunConfigurationSelection,
): void {
  if (!storage) return;
  storage.setItem(
    key,
    JSON.stringify({
      ...(selection.targetProfileId ? { targetProfileId: selection.targetProfileId } : {}),
      ...(selection.dataSetIds?.length ? { dataSetIds: [...selection.dataSetIds] } : {}),
    }),
  );
}

export type PersistedRunConfiguration = {
  sourceRevision?: { sha?: string };
  buildId?: string;
  targetProfile?: { id?: string; name?: string };
  browserCaseProfile?: { engine?: string; channel?: string };
  account?: { id?: string; name?: string };
  dataSet?: { id?: string; name?: string };
};

/** Projects only persisted execution facts; it never fills missing values from current workspace state. */
export function projectRunConfiguration(run: PersistedRunConfiguration): RunConfigurationState {
  const values: RunConfigurationValue = {
    ...(run.sourceRevision?.sha ? { sourceRevision: run.sourceRevision.sha } : {}),
    ...(run.buildId ? { buildId: run.buildId } : {}),
    ...(run.targetProfile?.id ? { targetProfileId: run.targetProfile.id } : {}),
    ...(run.targetProfile?.name ? { targetName: run.targetProfile.name } : {}),
    ...(run.account?.id ? { accountId: run.account.id } : {}),
    ...(run.account?.name ? { accountName: run.account.name } : {}),
    ...(run.browserCaseProfile
      ? {
          browserProfile: [run.browserCaseProfile.engine, run.browserCaseProfile.channel]
            .filter(Boolean)
            .join(" · "),
        }
      : {}),
    ...(run.dataSet?.id ? { dataSetId: run.dataSet.id } : {}),
    ...(run.dataSet?.name ? { dataSetName: run.dataSet.name } : {}),
  };
  return { values, frozen: true };
}
