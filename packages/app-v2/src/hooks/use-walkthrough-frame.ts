import { useEffect, useState } from "react";
import type { RunProductService } from "../data/run-product-service";

export function useFrameUrl(runService: RunProductService, runId: string, framePath: string | undefined) {
  const key = `${runId}:${framePath ?? ""}`;
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState<{
    key: string;
    status: "loading" | "ready" | "error";
    url?: string;
  }>({ key, status: "loading" });
  useEffect(() => {
    let url: string | undefined;
    let active = true;
    setFrame({ key, status: "loading" });
    if (!framePath || !runService.loadFrame) {
      setFrame({ key, status: "error" });
      return;
    }
    runService
      .loadFrame(runId, framePath)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setFrame({ key, status: "ready", url });
      })
      .catch(() => {
        if (active) setFrame({ key, status: "error" });
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [runService, runId, framePath, key, attempt]);
  return {
    ...(frame.key === key ? frame : { key, status: "loading" as const, url: undefined }),
    retry: () => setAttempt((value) => value + 1),
    failed: () => setFrame({ key, status: "error" }),
  };
}

