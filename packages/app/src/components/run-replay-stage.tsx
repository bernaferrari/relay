import { Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { useServer, type JobInfo, type PersistedRun } from "../context/server";
import { Icon } from "./icon";
import { EmptyState } from "./empty-state";
import { cn } from "../lib/cn";
import { kindIcon } from "./step-list-metadata";
import type { FrameCanvasItem } from "../lib/frame-canvas-presentation";
import { executionMoments, executionStateLabel } from "../lib/execution-moments";
import { ExecutionTimeline } from "./execution-timeline";
import { RunGraph } from "./run-graph";
import { runElapsedAtStep } from "../lib/run-review-model";
import {
  deriveReviewCut,
  nextReviewSourceMs,
  reviewTimeToSourceMs,
  sourceTimeToReviewMs,
} from "../lib/review-cut";
import { seg, segBtn, segBtnOn } from "../lib/ui";
import type { RunEvidenceEvent, RunEvidenceQuery } from "@relay/protocol";
import { formatStepDuration, runStateDot } from "../lib/run-review-presentation";
import { DeviceVideoStream } from "./device-video-stream";

type VideoArtifactData = {
  startedAt?: number;
  stoppedAt?: number;
  durationMs?: number;
  files?: { path: string; bytes?: number }[];
  result?: unknown;
};

/** The primary run-review surface: captured playback with a concise scrubber.
 * The optional screen view remains secondary to the evidence people can see. */
export function RunReplayStage(props: {
  job: JobInfo;
  items: FrameCanvasItem[];
  evidence: RunEvidenceQuery | null;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpenEvidence: (event: RunEvidenceEvent) => void;
  onBack: () => void;
}) {
  const server = useServer();
  const [stageMode, setStageMode] = createSignal<"replay" | "map">("replay");
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(1);
  const [mediaAspect, setMediaAspect] = createSignal<number | null>(null);
  const [liveVideoReady, setLiveVideoReady] = createSignal(false);
  const [liveVideoRetrying, setLiveVideoRetrying] = createSignal(false);
  const [liveVideoAttempt, setLiveVideoAttempt] = createSignal(0);
  let liveVideoRetryTimer: number | undefined;
  const cycleSpeed = () => setSpeed((current) => (current >= 8 ? 1 : current * 2));
  const snapshot = () =>
    props.job.recipeSnapshot ?? server.recipes().find((recipe) => recipe.id === props.job.action);
  const nodes = createMemo(() =>
    executionMoments({ recipe: snapshot(), job: props.job, recipes: server.recipes() }),
  );
  const count = () => Math.max(nodes().length, 1);
  const index = () => Math.max(0, Math.min(props.selectedIndex, count() - 1));
  const node = () => nodes()[index()];
  const elapsed = () => runElapsedAtStep(props.job.steps ?? [], index());
  const totalDuration = () =>
    (props.job.steps ?? []).reduce(
      (duration, step) => duration + Math.max(0, step.durationMs ?? 0),
      0,
    );
  const frameSrc = () => {
    const item = props.items[index()];
    if (item?.src) return item.src;
    const frame = node()?.frame;
    if (!frame) return null;
    if (frame.base64) return `data:${frame.mime || "image/png"};base64,${frame.base64}`;
    if (props.job.persisted || props.job.runDir) {
      return server.frameUrlForPersisted(props.job as unknown as PersistedRun, frame);
    }
    return null;
  };
  const liveVideoSrc = createMemo(() => {
    if (
      liveVideoRetrying() ||
      !["running", "paused"].includes(props.job.status) ||
      props.job.serial !== server.selectedDevice()
    ) {
      return null;
    }
    const base = server.serverUrl().replace(/\/+$/, "");
    if (!props.job.serial || !base) return null;
    return `${base}/device/stream?serial=${encodeURIComponent(props.job.serial)}&attempt=${liveVideoAttempt()}`;
  });
  const retryLiveVideo = () => {
    setLiveVideoReady(false);
    setLiveVideoRetrying(true);
    window.clearTimeout(liveVideoRetryTimer);
    liveVideoRetryTimer = window.setTimeout(() => {
      setLiveVideoAttempt((attempt) => attempt + 1);
      setLiveVideoRetrying(false);
    }, 1_200);
  };
  createEffect(
    on(
      () => props.job.id,
      () => {
        setLiveVideoReady(false);
        setLiveVideoRetrying(false);
        setLiveVideoAttempt(0);
      },
    ),
  );
  onCleanup(() => window.clearTimeout(liveVideoRetryTimer));
  const glyphFor = (stepIndex: number) => {
    const kind = snapshot()?.steps[stepIndex]?.kind;
    return kind ? kindIcon(kind) : "bolt";
  };
  const move = (delta: number) =>
    props.onSelect(Math.max(0, Math.min(index() + delta, count() - 1)));
  const togglePlayback = () => {
    if (playing()) {
      setPlaying(false);
      return;
    }
    if (index() === count() - 1) props.onSelect(0);
    setPlaying(true);
  };

  // Leaving replay for the graph shouldn't leave a video/frame-stepper
  // running invisibly behind it.
  createEffect(() => {
    if (stageMode() !== "replay") setPlaying(false);
  });

  /* Video replay — when the run persisted a captured video, it becomes the
   * time source (step selection derives from currentTime instead of the
   * setTimeout-paced frame stepper below). */
  let videoRef: HTMLVideoElement | undefined;
  const [videoElapsedMs, setVideoElapsedMs] = createSignal(0);
  const [videoDurationMs, setVideoDurationMs] = createSignal<number | null>(null);
  const [reviewCutEnabled, setReviewCutEnabled] = createSignal(true);
  const [reviewCutSkipped, setReviewCutSkipped] = createSignal<number | null>(null);
  // Distinguishes a timeupdate-driven step change (don't re-seek, it would
  // fight the currently-playing video) from a user/keyboard-driven one.
  let seekingFromVideo = false;
  // `props.job` gets a fresh object reference on every background poll tick
  // (rows() re-spreads persisted runs each refresh) even though the run's
  // own data hasn't changed. Deriving these from raw `props.job` reads would
  // let a poll land mid-render and transiently null out the video fields —
  // unmounting the <video> element via the Show gate below and silently
  // killing playback. Keying on job.id (stable for the run being viewed)
  // makes these compute once per run, immune to that churn.
  const videoData = createMemo(
    on(
      () => props.job.id,
      () =>
        props.job.artifacts?.find((item) => item.kind === "video")?.data as
          | VideoArtifactData
          | undefined,
    ),
  );
  const videoFilePath = createMemo(() => videoData()?.files?.[0]?.path);
  // Disk runs arrive as PersistedRun (`dir`), live jobs as JobInfo (`runDir`) —
  // either proves the file exists on disk for the /runs/:id/video route.
  const hasVideo = createMemo(
    on(
      () => props.job.id,
      () =>
        Boolean(videoFilePath()) &&
        Boolean(props.job.persisted || props.job.runDir || (props.job as { dir?: string }).dir),
    ),
  );
  const videoSrc = createMemo(() =>
    hasVideo() ? server.videoUrlForRun(props.job.id, videoFilePath()!) : null,
  );
  const videoStart = createMemo(() => videoData()?.startedAt ?? props.job.startedAt ?? 0);
  const stepOffsetsMs = createMemo(() => {
    const steps = props.job.steps ?? [];
    const start = videoStart();
    let cumulative = 0;
    return steps.map((step) => {
      const offset = step.startedAt != null ? Math.max(0, step.startedAt - start) : cumulative;
      cumulative += Math.max(0, step.durationMs ?? 0);
      return offset;
    });
  });
  const deriveStepIndex = (elapsedMs: number): number => {
    const offsets = stepOffsetsMs();
    let best = 0;
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i]! <= elapsedMs) best = i;
    }
    return best;
  };
  const videoTotalDurationMs = createMemo(
    () => videoData()?.durationMs ?? videoDurationMs() ?? totalDuration(),
  );
  const reviewCut = createMemo(() =>
    deriveReviewCut({
      sourceDurationMs: videoTotalDurationMs(),
      sourceStartedAt: videoStart(),
      steps: props.job.steps ?? [],
      evidenceEvents: props.job.evidence?.events,
    }),
  );
  const cutActive = () => reviewCutEnabled() && reviewCut() != null;
  const reviewMarkerFractions = createMemo(() => {
    const cut = reviewCut();
    if (!cutActive() || !cut || cut.reviewDurationMs <= 0) return undefined;
    return stepOffsetsMs().map((offset) =>
      Math.max(0, Math.min(1, sourceTimeToReviewMs(cut, offset) / cut.reviewDurationMs)),
    );
  });
  const reviewGapFractions = createMemo(() => {
    const cut = reviewCut();
    if (!cutActive() || !cut || cut.reviewDurationMs <= 0) return undefined;
    let elapsed = 0;
    return cut.segments.slice(0, -1).map((segment) => {
      elapsed += segment.endMs - segment.startMs;
      return elapsed / cut.reviewDurationMs;
    });
  });
  const seekVideoTo = (idx: number) => {
    const video = videoRef;
    if (!video) return;
    const target = (stepOffsetsMs()[idx] ?? 0) / 1000;
    if (!Number.isFinite(target)) return;
    if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
    setVideoElapsedMs(target * 1000);
  };
  const onVideoTimeUpdate = (event: Event) => {
    const video = event.currentTarget as HTMLVideoElement;
    const elapsedMs = video.currentTime * 1000;
    const cut = reviewCut();
    if (playing() && cutActive() && cut) {
      const next = nextReviewSourceMs(cut, elapsedMs + 20);
      if (next != null && next > elapsedMs + 20) {
        const skipped = Math.max(0, next - elapsedMs);
        video.currentTime = next / 1000;
        setVideoElapsedMs(next);
        setReviewCutSkipped(skipped);
        window.setTimeout(() => setReviewCutSkipped(null), 1_400);
        return;
      }
    }
    setVideoElapsedMs(elapsedMs);
    const derived = deriveStepIndex(elapsedMs);
    if (derived !== index()) {
      seekingFromVideo = true;
      props.onSelect(derived);
    }
  };
  const onVideoLoadedMetadata = (event: Event) => {
    const video = event.currentTarget as HTMLVideoElement;
    if (Number.isFinite(video.duration)) setVideoDurationMs(video.duration * 1000);
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setMediaAspect(video.videoWidth / video.videoHeight);
    }
    seekVideoTo(index());
  };
  const timelineElapsedMs = () => {
    const cut = reviewCut();
    return hasVideo() && cutActive() && cut
      ? sourceTimeToReviewMs(cut, videoElapsedMs())
      : hasVideo()
        ? videoElapsedMs()
        : elapsed();
  };
  const timelineTotalMs = () => {
    const cut = reviewCut();
    return hasVideo() && cutActive() && cut
      ? cut.reviewDurationMs
      : hasVideo()
        ? videoTotalDurationMs()
        : totalDuration();
  };
  const evidenceMarkers = createMemo(() => {
    const total = timelineTotalMs();
    if (total <= 0) return [];
    const cut = reviewCut();
    return (props.evidence?.events ?? []).map((event) => {
      const sourceOffset = event.at >= videoStart() ? event.at - videoStart() : event.at;
      const projected = cutActive() && cut ? sourceTimeToReviewMs(cut, sourceOffset) : sourceOffset;
      return { event, fraction: Math.max(0, Math.min(1, projected / total)) };
    });
  });
  // Seeking effect: fires whenever the selected step changes from anywhere
  // (timeline chip, step list, arrow keys) except when the change originated
  // from the video's own timeupdate — that direction is already in sync.
  createEffect(() => {
    if (!hasVideo()) return;
    const idx = index();
    if (seekingFromVideo) {
      seekingFromVideo = false;
      return;
    }
    seekVideoTo(idx);
  });
  createEffect(
    on(
      () => `${props.job.id}:${index()}:${frameSrc() ?? videoSrc() ?? "empty"}`,
      () => setMediaAspect(null),
    ),
  );
  createEffect(() => {
    if (!hasVideo()) return;
    const video = videoRef;
    if (!video) return;
    if (playing()) {
      if (video.ended) video.currentTime = 0;
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  });
  createEffect(() => {
    if (!hasVideo()) return;
    if (videoRef) videoRef.playbackRate = speed();
  });
  createEffect(() => {
    // Frame-per-step fallback pacing — only drives playback when there is no
    // video to scrub against.
    if (hasVideo()) return;
    if (!playing()) return;
    const current = index();
    if (current >= count() - 1) {
      setPlaying(false);
      return;
    }
    const rawDuration = props.job.steps?.[current]?.durationMs ?? 700;
    const baseDelay = Math.max(650, Math.min(rawDuration, 2_200));
    const timer = window.setTimeout(
      () => props.onSelect(Math.min(current + 1, count() - 1)),
      Math.max(80, Math.round(baseDelay / speed())),
    );
    onCleanup(() => window.clearTimeout(timer));
  });
  return (
    <section
      class="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--background-deep)]"
      aria-label="Play run"
      tabindex={-1}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          setPlaying(false);
          move(-1);
        }
        if (event.key === "ArrowRight") {
          setPlaying(false);
          move(1);
        }
        if (event.key === " ") {
          event.preventDefault();
          togglePlayback();
        }
      }}
    >
      <div
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--text-strong)_8%,transparent)_1px,transparent_0)] [background-size:20px_20px]"
        aria-hidden="true"
      />
      <header class="relative z-[1] grid min-h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
        <button
          type="button"
          class="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-body font-medium text-[var(--text-base)] transition-colors hover:bg-surface-base-hover hover:text-[var(--text-strong)]"
          onClick={props.onBack}
        >
          <Icon name="chevron-left" size={14} /> All runs
        </button>
        <Show when={nodes().length > 0}>
          <div class={seg} role="group" aria-label="Run report view">
            <button
              type="button"
              class={cn(segBtn, stageMode() === "replay" && segBtnOn)}
              aria-pressed={stageMode() === "replay"}
              onClick={() => setStageMode("replay")}
            >
              <Icon name="play" size={12} /> Play run
            </button>
            <button
              type="button"
              class={cn(segBtn, stageMode() === "map" && segBtnOn)}
              aria-pressed={stageMode() === "map"}
              onClick={() => setStageMode("map")}
            >
              <Icon name="move" size={12} /> Screens
            </button>
          </div>
        </Show>
        <Show when={nodes().length > 0}>
          <div class="flex min-w-0 items-center justify-end gap-2 text-micro text-text-weaker">
            <span class="shrink-0 font-mono tabular-nums">
              {index() + 1} / {nodes().length}
            </span>
            <span class="h-3 w-px bg-border-weak-base" aria-hidden="true" />
            <span class="inline-flex min-w-0 items-center gap-1.5">
              <i
                class={cn(
                  "size-1.5 shrink-0 rounded-full",
                  runStateDot(node()?.state ?? "planned"),
                )}
              />
              <span class="truncate">
                {executionStateLabel(node()?.state ?? "planned", "step")}
              </span>
            </span>
          </div>
        </Show>
      </header>
      <Show when={nodes().length === 0}>
        <div class="relative z-[1] grid min-h-0 flex-1 place-items-center px-8 py-5">
          <EmptyState
            icon="camera"
            title="Nothing to play yet"
            description="This run didn’t capture steps or screenshots. Run a path that includes device actions, then open it again."
          />
        </div>
      </Show>
      <Show when={nodes().length > 0 && stageMode() === "map"}>
        <div class="relative z-[1] min-h-0 flex-1 overflow-hidden">
          <RunGraph
            moments={nodes()}
            items={props.items}
            selectedIndex={index()}
            onSelect={props.onSelect}
          />
        </div>
      </Show>
      <Show when={nodes().length > 0 && stageMode() === "replay"}>
        <div class="relative z-[1] flex min-h-0 flex-1 items-center justify-center px-5 py-3">
          {/* Evidence is shown as evidence, not dressed up as a generic phone.
            Its captured dimensions choose the surface ratio, so tablets,
            landscape devices, browsers, and phones all use the available stage. */}
          <div
            class="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-xl bg-[var(--background-base)] shadow-[0_0_0_1px_rgb(0_0_0/10%),0_12px_28px_-8px_rgb(0_0_0/28%),0_28px_72px_-28px_rgb(0_0_0/45%)]"
            style={{
              "aspect-ratio": String(mediaAspect() ?? 9 / 16),
              width: (mediaAspect() ?? 9 / 16) > 1 ? "100%" : "auto",
              height: (mediaAspect() ?? 9 / 16) > 1 ? "auto" : "100%",
            }}
          >
            <Show
              keyed
              when={liveVideoSrc()}
              fallback={
                <Show
                  when={hasVideo()}
                  fallback={
                    <Show
                      when={frameSrc()}
                      fallback={
                        <div class="grid justify-items-center gap-1.5 px-6 text-center">
                          <Icon
                            name={node()?.state === "failed" ? "alert" : "camera"}
                            size={16}
                            class="text-text-weaker"
                          />
                          <span class="text-caption/[1.4] text-text-weaker">
                            {node()?.observed ? "No screenshot captured here" : "Step not reached"}
                          </span>
                        </div>
                      }
                    >
                      {(src) => (
                        <img
                          src={src()}
                          alt={`Step ${index() + 1} evidence`}
                          class="h-full w-full object-contain"
                          onLoad={(event) => {
                            const image = event.currentTarget;
                            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                              setMediaAspect(image.naturalWidth / image.naturalHeight);
                            }
                          }}
                        />
                      )}
                    </Show>
                  }
                >
                  <video
                    ref={(element) => {
                      videoRef = element;
                    }}
                    src={videoSrc() ?? undefined}
                    muted
                    playsinline
                    preload="metadata"
                    class="h-full w-full object-contain"
                    onTimeUpdate={onVideoTimeUpdate}
                    onLoadedMetadata={onVideoLoadedMetadata}
                    onEnded={() => setPlaying(false)}
                  />
                </Show>
              }
            >
              {(src) => (
                <div class="absolute inset-0 bg-[var(--background-base)]">
                  <DeviceVideoStream
                    src={src}
                    requestHeaders={server.previewRequestHeaders()}
                    onReady={() => setLiveVideoReady(true)}
                    onFailure={retryLiveVideo}
                    onSize={(width, height) => {
                      if (width > 0 && height > 0) setMediaAspect(width / height);
                    }}
                  />
                  <Show when={!liveVideoReady()}>
                    <div class="absolute inset-0 grid place-items-center text-caption text-text-weaker">
                      Connecting to live device…
                    </div>
                  </Show>
                  <Show when={liveVideoReady()}>
                    <span class="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2 py-1 text-micro font-medium text-white backdrop-blur-sm">
                      <span class="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                      Live
                    </span>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </div>
        <div class="relative z-[1] mx-auto mb-2 flex max-w-[78%] items-center justify-center gap-2 px-4 text-center">
          <Icon
            name={glyphFor(index())}
            size={12}
            class={node()?.state === "failed" ? "text-icon-critical-base" : "text-text-weaker"}
          />
          <p class="m-0 truncate text-caption font-medium text-text-base">{node()?.title}</p>
        </div>
        <Show when={hasVideo() && reviewCut()}>
          {(cut) => (
            <div class="relative z-[2] mx-auto flex w-full max-w-[560px] items-center justify-between gap-3 px-4 pb-1">
              <div class="min-w-0">
                <p class="m-0 text-caption font-medium text-text-base">Focused review</p>
                <p class="m-0.5 text-micro text-text-weaker">
                  Skips {formatStepDuration(cut().skippedDurationMs)} of unchanged time. Original
                  video stays intact.
                </p>
              </div>
              <div class={seg} role="group" aria-label="Run timeline">
                <button
                  type="button"
                  class={cn(segBtn, !reviewCutEnabled() && segBtnOn)}
                  aria-pressed={!reviewCutEnabled()}
                  onClick={() => setReviewCutEnabled(false)}
                >
                  Original
                </button>
                <button
                  type="button"
                  class={cn(segBtn, reviewCutEnabled() && segBtnOn)}
                  aria-pressed={reviewCutEnabled()}
                  onClick={() => setReviewCutEnabled(true)}
                >
                  Review cut
                </button>
              </div>
            </div>
          )}
        </Show>
        <Show when={reviewCutSkipped()}>
          {(skipped) => (
            <div class="pointer-events-none absolute right-4 bottom-[72px] z-[4] rounded-full border border-[var(--border-weak-base)] bg-[color-mix(in_srgb,var(--surface-base-hover)_94%,transparent)] px-2.5 py-1 text-micro font-medium text-text-base shadow-[0_8px_24px_rgb(0_0_0/28%)] backdrop-blur">
              Skipped {formatStepDuration(skipped())} unchanged
            </div>
          )}
        </Show>
        <ExecutionTimeline
          moments={nodes()}
          selectedIndex={index()}
          onSelect={(nextIndex) => {
            setPlaying(false);
            props.onSelect(nextIndex);
          }}
          mode="replay"
          playing={playing()}
          onTogglePlayback={togglePlayback}
          onPrevious={() => {
            setPlaying(false);
            move(-1);
          }}
          onNext={() => {
            setPlaying(false);
            move(1);
          }}
          elapsedMs={timelineElapsedMs()}
          totalDurationMs={timelineTotalMs()}
          markerFractions={reviewMarkerFractions()}
          skippedFractions={reviewGapFractions()}
          evidenceMarkers={evidenceMarkers()}
          onEvidenceSelect={props.onOpenEvidence}
          speed={speed()}
          onCycleSpeed={cycleSpeed}
          onScrub={(fraction) => {
            const video = videoRef;
            if (!hasVideo() || !video) return;
            const cut = reviewCut();
            const target =
              cutActive() && cut
                ? reviewTimeToSourceMs(cut, fraction * cut.reviewDurationMs) / 1000
                : fraction * (videoTotalDurationMs() / 1000);
            video.currentTime = Math.max(0, Math.min(target, video.duration || target));
            setVideoElapsedMs(target * 1000);
          }}
        />
      </Show>
    </section>
  );
}
