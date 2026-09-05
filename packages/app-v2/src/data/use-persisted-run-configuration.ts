import { useCallback, useEffect, useRef, useState } from "react";
import type { RunConfigurationOption, RunConfigurationSelection } from "./run-configuration";
import type { Platform } from "../platform/types";

export type AsyncRunConfigurationStorage = Pick<Platform["storage"], "get" | "set">;
export function runConfigurationStorageKey(input: {
  server: string;
  organization?: string;
  project?: string;
  appId?: string;
  entity: string;
}): string {
  return `run-config:${JSON.stringify([input.server, input.organization ?? "", input.project ?? "", input.appId ?? "", input.entity])}`;
}

export function useRunConfigurationKey(platform: Platform, entity: string, appId?: string) {
  const identity = JSON.stringify([entity, appId]);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setScope(undefined);
    setAttempt((value) => value + 1);
  }, []);
  const [scope, setScope] = useState<{ identity: string; key?: string; error?: string }>();
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(async () => {
        const connection = await platform.getServerConnection?.();
        const server = connection?.url ?? (await platform.getServerUrl());
        return runConfigurationStorageKey({
          server,
          organization: connection?.organizationId,
          project: connection?.projectId,
          appId,
          entity,
        });
      })
      .then((key) => {
        if (active) setScope({ identity, key });
      })
      .catch(() => {
        if (active)
          setScope({
            identity,
            error: "Could not identify this workspace. Try again before restoring a configuration.",
          });
      });
    return () => {
      active = false;
    };
  }, [platform, entity, appId, identity, attempt]);
  return {
    ...(scope?.identity === identity ? scope : { key: undefined, error: undefined }),
    retry,
  };
}

function parseSelection(raw: string | null): RunConfigurationSelection {
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved configuration");
  const record = value as Record<string, unknown>;
  const ids = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((id) => typeof id === "string") ? value : undefined;
  return {
    ...(typeof record.targetProfileId === "string"
      ? { targetProfileId: record.targetProfileId }
      : {}),
    ...(ids(record.targetProfileIds) ? { targetProfileIds: ids(record.targetProfileIds) } : {}),
    ...(ids(record.dataSetIds) ? { dataSetIds: ids(record.dataSetIds) } : {}),
  };
}

type State = {
  key?: string;
  selection: RunConfigurationSelection;
  loaded: boolean;
  edited: boolean;
  restored?: boolean;
  error?: string;
  saving?: boolean;
};
const empty: RunConfigurationSelection = {};
export function usePersistedRunConfiguration({
  storage,
  key,
  initial = empty,
  targetOptions,
}: {
  storage?: AsyncRunConfigurationStorage;
  key?: string;
  initial?: RunConfigurationSelection;
  targetOptions?: readonly RunConfigurationOption[];
}) {
  const [state, setState] = useState<State>({
    key,
    selection: initial,
    loaded: false,
    edited: false,
  });
  const [attempt, setAttempt] = useState(0);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!key) return;
    let active = true;
    setState((current) =>
      current.key === key
        ? { ...current, loaded: false, error: undefined }
        : { key, selection: initialRef.current, loaded: false, edited: false },
    );
    void Promise.resolve()
      .then(() => storage?.get(key) ?? null)
      .then((raw) => {
        const saved = parseSelection(raw);
        if (active)
          setState((current) => ({
            ...current,
            key,
            selection:
              current.key === key && current.edited
                ? current.selection
                : { ...initialRef.current, ...saved },
            loaded: true,
            restored: raw !== null,
          }));
      })
      .catch(() => {
        if (active)
          setState((current) => ({
            ...current,
            loaded: false,
            error: "Could not restore the saved configuration. Try again before running.",
          }));
      });
    return () => {
      active = false;
    };
  }, [key, storage, attempt]);
  const setSelection = useCallback(
    (selection: RunConfigurationSelection) => {
      if (!key) return;
      setState((current) => ({ ...current, key, selection, edited: true }));
    },
    [key],
  );
  const current = state.key === key ? state : undefined;
  const selection = current?.selection ?? empty;
  const loaded = current?.loaded ?? false;
  const edited = current?.edited ?? false;
  useEffect(() => {
    if (!key || !storage || !loaded || !edited) return;
    let active = true;
    setState((current) => ({ ...current, saving: true }));
    const write = writes.current
      .catch(() => undefined)
      .then(() => storage.set(key, JSON.stringify(selection)));
    writes.current = write;
    void write
      .then(() => {
        if (active) setState((current) => ({ ...current, saving: false, error: undefined }));
      })
      .catch(() => {
        if (active)
          setState((current) => ({
            ...current,
            saving: false,
            error:
              "Could not remember this configuration. Your selections are still available on this page.",
          }));
      });
    return () => {
      active = false;
    };
  }, [key, storage, selection, loaded, edited, attempt]);
  const selectedIds =
    selection.targetProfileIds ?? (selection.targetProfileId ? [selection.targetProfileId] : []);
  const targetUnavailable = Boolean(
    targetOptions && selectedIds.some((id) => !targetOptions.some((item) => item.id === id)),
  );
  return {
    selection,
    setSelection,
    pristine: loaded && !edited && !current?.restored,
    loading: !key || !loaded,
    saving: current?.saving ?? false,
    error: current?.error,
    retry: () => setAttempt((value) => value + 1),
    targetUnavailable,
  };
}
