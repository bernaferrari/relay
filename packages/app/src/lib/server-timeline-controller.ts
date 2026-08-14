import { createSignal } from "solid-js";
import { levelFromLine, uid } from "./api";
import type { Frame, LogLine } from "./api-types";

export function createServerTimelineController() {
  const [logs, setLogs] = createSignal<LogLine[]>([]);
  const [frames, setFrames] = createSignal<Frame[]>([]);
  const [frameIndex, setFrameIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  let logSequence = 0;
  let playTimer: NodeJS.Timeout | undefined;

  function appendLog(text: string, level?: LogLine["level"], jobId?: string): void {
    logSequence += 1;
    setLogs((previous) => [
      ...previous.slice(-400),
      {
        id: logSequence,
        text,
        level: level ?? levelFromLine(text),
        at: Date.now(),
        jobId,
      },
    ]);
  }

  function clearLogs(): void {
    logSequence = 0;
    setLogs([]);
  }

  function pushFrame(frame: Omit<Frame, "id">): Frame {
    const full: Frame = { ...frame, id: uid() };
    setFrames((previous) => {
      const next = [...previous, full].slice(-80);
      setFrameIndex(next.length - 1);
      return next;
    });
    return full;
  }

  function currentFrame(): Frame | null {
    const list = frames();
    if (list.length === 0) return null;
    const index = Math.min(Math.max(frameIndex(), 0), list.length - 1);
    return list[index] ?? null;
  }

  function stopPlayback(): void {
    setPlaying(false);
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = undefined;
    }
  }

  function clearFrames(): void {
    setFrames([]);
    setFrameIndex(0);
    stopPlayback();
  }

  function togglePlayback(): void {
    if (playing()) {
      stopPlayback();
      return;
    }
    if (frames().length === 0) return;
    setPlaying(true);
    playTimer = setInterval(() => {
      setFrameIndex((index) => {
        const max = frames().length - 1;
        if (index >= max) {
          stopPlayback();
          return index;
        }
        return index + 1;
      });
    }, 900);
  }

  return {
    logs,
    appendLog,
    clearLogs,
    frames,
    frameIndex,
    setFrameIndex,
    currentFrame,
    playing,
    pushFrame,
    clearFrames,
    togglePlayback,
    stopPlayback,
  };
}
