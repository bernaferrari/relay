import type { DeviceInfo, JobInfo } from "../context/server";
import type { RunChip } from "../context/workbench";
import { fmtAgo, fmtDur, fmtMs, statusTone, titleize } from "../lib/job";

export type ReviewedRunFacts = {
  tone: string;
  word: string;
  when: string;
  dur: string;
  device: string;
  live: boolean;
  error?: string;
};

export type ChipFacts = {
  tone: string;
  label: string;
  detail: string;
  live: boolean;
  tip: string;
  word: string;
};

export function toneText(tone: string): string {
  if (tone === "pass") return "text-icon-success-base";
  if (tone === "fail") return "text-icon-critical-base";
  if (tone === "heal") return "text-icon-warning-base";
  if (tone === "run") return "text-icon-info-base";
  return "text-text-weak";
}

export function toneDot(tone: string): string {
  if (tone === "pass") return "bg-icon-success-base";
  if (tone === "fail") return "bg-icon-critical-base";
  if (tone === "heal") return "bg-icon-warning-base";
  if (tone === "run") return "bg-icon-info-base";
  return "bg-text-weaker";
}

export function checkpointReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    authentication: "Authentication",
    consent: "Approval needed",
    verification: "Verification",
    captcha: "CAPTCHA",
    permission: "Permission",
    review: "Review",
    other: "Human checkpoint",
  };
  return labels[reason] ?? "Human checkpoint";
}

export function chipFacts(chip: RunChip, clock: number, devices: readonly DeviceInfo[]): ChipFacts {
  const status: JobInfo["status"] =
    chip.kind === "live" ? chip.job.status : (chip.run.status as JobInfo["status"]);
  const tone = statusTone(status);
  const live =
    chip.kind === "live" && (status === "running" || status === "paused" || status === "queued");
  const word = statusWord(status);
  const when =
    live && chip.kind === "live" ? fmtDur(chip.job, clock) : fmtAgo(chip.ts, clock) || "now";
  const at = new Date(chip.ts);
  const hm = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const duration =
    chip.kind === "disk"
      ? fmtMs(chip.run.durationMs)
      : chip.kind === "live" && chip.job.finishedAt
        ? fmtDur(chip.job, clock)
        : "";
  const rawError =
    chip.kind === "disk" ? chip.run.error : chip.kind === "live" ? chip.job.error : undefined;
  const error = rawError ? rawError.replace(/\s+/g, " ").slice(0, 48) : "";
  const serial = chip.kind === "disk" ? chip.run.serial : chip.job.serial;
  const device = serial
    ? (devices.find((item) => item.serial === serial)?.name ?? serial.slice(0, 8))
    : "";
  const bits = [word, when, hm];
  if (duration) bits.push(duration);
  return {
    tone,
    label: bits.join(" · "),
    detail: [error, device].filter(Boolean).join(" · "),
    live,
    tip: `${word} · ${at.toLocaleString()}${rawError ? ` — ${rawError}` : ""}`,
    word,
  };
}

export function reviewedRunFacts(
  chip: RunChip | null,
  clock: number,
  devices: readonly DeviceInfo[],
): ReviewedRunFacts | null {
  if (!chip) return null;
  const status: JobInfo["status"] =
    chip.kind === "live" ? chip.job.status : (chip.run.status as JobInfo["status"]);
  const tone = statusTone(status);
  const live = chip.kind === "live" && (status === "running" || status === "paused");
  const serial = chip.kind === "live" ? chip.job.serial : chip.run.serial;
  const device = serial ? (devices.find((item) => item.serial === serial)?.name ?? serial) : "";
  const when =
    chip.kind === "disk"
      ? fmtAgo(chip.run.writtenAt, clock)
      : live
        ? ""
        : fmtAgo(chip.job.finishedAt, clock);
  const dur = chip.kind === "disk" ? fmtMs(chip.run.durationMs) : fmtDur(chip.job, clock);
  const error =
    chip.kind === "live" ? chip.job.error : chip.kind === "disk" ? chip.run.error : undefined;
  return { tone, word: statusWord(status), when, dur, device, live, error };
}

function statusWord(status: JobInfo["status"]): string {
  return status === "ok"
    ? "Passed"
    : status === "error"
      ? "Failed"
      : status === "healed"
        ? "Healed"
        : status === "queued"
          ? "Queued"
          : status === "running"
            ? "Running"
            : status === "paused"
              ? "Paused"
              : titleize(status);
}
