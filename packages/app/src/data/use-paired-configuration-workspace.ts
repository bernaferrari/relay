import { useCallback, useEffect, useState } from "react";
import type { Platform } from "../platform/types";
import {
  emptyPairedWorkspace,
  PAIRED_CONFIGURATION_STORAGE_KEY,
  parsePairedConfigurationWorkspace,
  type PairedConfigurationWorkspace,
} from "./paired-configuration";

export function usePairedConfigurationWorkspace(platform: Platform) {
  const [workspace, setWorkspace] = useState<PairedConfigurationWorkspace>(emptyPairedWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.resolve(platform.storage.get(PAIRED_CONFIGURATION_STORAGE_KEY))
      .then((raw) => {
        if (!active) return;
        setWorkspace(parsePairedConfigurationWorkspace(raw));
        setError(undefined);
      })
      .catch(() => {
        if (active) setError("Could not restore the saved Browser and Account workspace.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [platform]);

  const save = useCallback(
    async (next: PairedConfigurationWorkspace) => {
      const stored = { ...next, updatedAt: Date.now() };
      await platform.storage.set(PAIRED_CONFIGURATION_STORAGE_KEY, JSON.stringify(stored));
      setWorkspace(stored);
    },
    [platform],
  );

  return { workspace, loading, error, save };
}
