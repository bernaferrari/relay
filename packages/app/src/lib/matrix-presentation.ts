import type { MatrixExpansion } from "@relay/protocol";

export type MatrixRunPreview = {
  targetCount: number;
  repetitions: number;
  runCount: number;
  summary: string;
  profiles: Array<{ name: string; platform: string; osVersion?: string }>;
  exclusions: Array<{ name: string; reason: string }>;
};

export function matrixRunPreview(
  expansion: MatrixExpansion,
  repetitions: number,
): MatrixRunPreview {
  const trials = Math.max(1, Math.floor(repetitions));
  const targetCount = expansion.profiles.length;
  const runCount = targetCount * trials;
  return {
    targetCount,
    repetitions: trials,
    runCount,
    summary: `${targetCount} environment${targetCount === 1 ? "" : "s"} · ${trials} trial${trials === 1 ? "" : "s"} · ${runCount} run${runCount === 1 ? "" : "s"}`,
    profiles: expansion.profiles.map((profile) => ({
      name: profile.name,
      platform: profile.platform,
      ...(profile.osVersion ? { osVersion: profile.osVersion } : {}),
    })),
    exclusions: expansion.excluded.map((item) => ({
      name: item.profile.name,
      reason: item.reason,
    })),
  };
}
