"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Circle, MousePointer2, Wrench, X } from "lucide-react";

type Phase = "record" | "fail" | "repair" | "pass";

const phases: { id: Phase; label: string; status: string }[] = [
  { id: "record", label: "Record", status: "Recording" },
  { id: "fail", label: "Run", status: "Failed" },
  { id: "repair", label: "Repair", status: "Repairing" },
  { id: "pass", label: "Rerun", status: "Passed" },
];

// Lines printed by `pnpm demo` (scripts/first-run-demo.mjs).
const logs: Record<Phase, string> = {
  record: "Recording: Sign in, open Settings, and check the layout",
  fail: "Caught the defect: Save overlaps the team seats (layout check failed).",
  repair: "Repair: removed the overlap in this owned demo website; rerunning the unchanged Test.",
  pass: "Layout check passed. Screenshot review is pending; the demo makes no human decision.",
};

const steps = [
  { label: "Tap “Continue as Member”", ms: "157ms" },
  { label: "Tap “Settings”", ms: "104ms" },
  { label: "See “Team seats”", ms: "13ms" },
  { label: "Check · Save and seats don’t overlap", ms: "42ms", check: true },
  { label: "Screenshot · Workspace settings", ms: "38ms" },
];

const INTERVAL = 4200;

export function RunReel() {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const phase = phases[index]!.id;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAuto(false);
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      threshold: 0.35,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !visible) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % phases.length), INTERVAL);
    return () => clearTimeout(timer);
  }, [auto, visible, index]);

  const broken = phase === "record" || phase === "fail";

  return (
    <div ref={root} className="relative">
      <div role="group" aria-label="Demo stage" className="mb-4 grid grid-cols-4 gap-1.5 sm:gap-2">
        {phases.map((p, i) => {
          const active = i === index;
          const done = i < index;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setAuto(false);
                setIndex(i);
              }}
              className="group relative flex min-h-11 flex-col items-start justify-end gap-2 rounded-lg px-1 pt-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={`flex items-baseline gap-2 text-xs font-medium transition-colors sm:text-sm ${active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}
              >
                <span className="font-mono text-[0.7rem] tabular-nums opacity-60">0{i + 1}</span>
                {p.label}
              </span>
              <span className="relative h-[3px] w-full overflow-hidden rounded-full bg-border">
                <span
                  key={active && auto && visible ? `run-${index}` : `idle-${i}`}
                  className={`ribbon-line absolute inset-y-0 left-0 rounded-full ${done ? "w-full" : active ? (auto && visible ? "w-full origin-left animate-reel-fill" : "w-full") : "w-0"}`}
                  style={{ ["--reel" as string]: `${INTERVAL}ms` }}
                />
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_1px_0_color-mix(in_oklch,var(--foreground)_4%,transparent),0_24px_60px_-28px_color-mix(in_oklch,var(--ribbon-violet)_35%,transparent)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm font-semibold tracking-tight">
              Demo · Member layout
            </span>
            <span className="hidden rounded-md border px-1.5 py-0.5 font-mono text-[0.68rem] text-muted-foreground sm:inline">
              chromium
            </span>
          </div>
          <StatusChip phase={phase} />
        </div>

        <div className="grid md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <ol className="flex flex-col gap-0.5 border-b p-3 sm:p-4 md:border-r md:border-b-0">
            {steps.map((step, i) => {
              const state =
                phase === "record"
                  ? i <= 3
                    ? "recorded"
                    : "pending"
                  : phase === "repair"
                    ? "pending"
                    : step.check && phase === "fail"
                      ? "failed"
                      : i === 4 && phase === "fail"
                        ? "skipped"
                        : "passed";
              return (
                <li
                  key={step.label}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[0.8rem] transition-colors ${state === "failed" ? "bg-fail/10" : ""}`}
                >
                  <StepIcon state={state} />
                  <span
                    className={`min-w-0 flex-1 truncate ${state === "pending" || state === "skipped" ? "text-muted-foreground" : ""}`}
                  >
                    {step.label}
                  </span>
                  <span className="font-mono text-[0.68rem] tabular-nums text-muted-foreground">
                    {state === "passed" || state === "failed"
                      ? step.ms
                      : state === "recorded"
                        ? "rec"
                        : "—"}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="relative bg-muted/50 p-3 sm:p-5">
            {phase === "repair" ? <RepairDiff /> : <DemoFrame broken={broken} phase={phase} />}
          </div>
        </div>

        <div className="flex items-start gap-3 border-t bg-ink px-4 py-3 font-mono text-[0.72rem] leading-relaxed text-ink-foreground/80 sm:px-5">
          <span className="select-none text-ribbon-orange">$</span>
          <p aria-live="polite" key={phase} className="animate-reveal min-w-0">
            <span className="text-ink-foreground/45">pnpm demo · </span>
            {logs[phase]}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ phase }: { phase: Phase }) {
  const p = phases.find((x) => x.id === phase)!;
  const tone =
    phase === "fail"
      ? "bg-fail/12 text-fail"
      : phase === "pass"
        ? "bg-pass/12 text-pass"
        : phase === "record"
          ? "bg-ribbon-blue/12 text-ribbon-blue"
          : "bg-ribbon-orange/15 text-[color-mix(in_oklch,var(--ribbon-orange)_75%,var(--foreground))]";
  return (
    <span
      key={phase}
      className={`reveal-step inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {phase === "record" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      ) : phase === "fail" ? (
        <X className="size-3.5" />
      ) : phase === "pass" ? (
        <Check className="size-3.5" />
      ) : (
        <Wrench className="size-3.5" />
      )}
      {p.status}
    </span>
  );
}

function StepIcon({ state }: { state: string }) {
  const base = "grid size-5 shrink-0 place-items-center rounded-full";
  if (state === "passed")
    return (
      <span className={`${base} bg-pass/15 text-pass`}>
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  if (state === "failed")
    return (
      <span className={`${base} bg-fail text-white`}>
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  if (state === "recorded")
    return (
      <span className={`${base} bg-ribbon-blue/15 text-ribbon-blue`}>
        <MousePointer2 className="size-3" strokeWidth={2.5} />
      </span>
    );
  return (
    <span className={`${base} text-muted-foreground/50`}>
      <Circle className="size-3.5" strokeDasharray="2 2" />
    </span>
  );
}

/** A faithful sketch of the demo's settings screen; the defect is the fixture's real CSS. */
function DemoFrame({ broken, phase }: { broken: boolean; phase: Phase }) {
  const tone = phase === "fail" ? "fail" : phase === "pass" ? "pass" : "blue";
  const outline = {
    fail: "border-fail bg-fail/8",
    pass: "border-pass bg-pass/8",
    blue: "border-ribbon-blue border-dashed bg-ribbon-blue/6",
  }[tone];
  const label = {
    fail: "Save overlaps Team seats",
    pass: "No overlap",
    blue: "Check: no overlap",
  }[tone];
  return (
    <figure className="m-0 overflow-hidden rounded-xl border bg-white text-[#141824] shadow-sm dark:border-white/10">
      <div className="flex items-center gap-2 border-b border-black/8 bg-[#f6f6f4] px-3 py-2">
        <span className="flex gap-1">
          <i className="size-2 rounded-full bg-black/12" />
          <i className="size-2 rounded-full bg-black/12" />
          <i className="size-2 rounded-full bg-black/12" />
        </span>
        <span className="mx-auto rounded bg-white px-2 py-0.5 font-mono text-[0.62rem] text-black/50">
          127.0.0.1:8792/settings
        </span>
      </div>
      <div className="px-5 pt-5 pb-6">
        <p className="text-[0.55rem] font-semibold tracking-[0.14em] text-black/40 uppercase">
          Northstar / Demo workspace
        </p>
        <p className="mt-1 text-base font-semibold tracking-tight">Workspace settings</p>
        <p className="mt-1 text-[0.65rem] text-black/50">
          Account <span className="rounded bg-[#e9edff] px-1 text-[#3b4fd8]">member</span>
        </p>
        <div className="relative mt-10">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-9 w-[9.5rem] shrink-0 items-center justify-between rounded-md border border-black/10 px-2.5 text-[0.65rem] text-black/60">
              Team seats remaining
              <b className="text-sm text-black">4</b>
              <span
                className={`absolute top-1/2 right-1 h-7 -translate-y-1/2 rounded-md bg-[#2f45d6] px-3 text-[0.65rem] leading-7 font-medium text-white shadow transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${broken ? "opacity-100" : "translate-x-[calc(100%+1.25rem)] opacity-0"}`}
                aria-hidden={!broken}
              >
                Save
              </span>
            </div>
            <span
              className={`h-7 rounded-md bg-[#2f45d6] px-3 text-[0.65rem] leading-7 font-medium text-white transition-opacity duration-500 ${broken ? "opacity-0" : "opacity-100"}`}
            >
              Save
            </span>
            <span className="ms-3 truncate text-[0.62rem] text-[#3b4fd8]">Language</span>
          </div>
          <div
            key={tone}
            className={`reveal-step pointer-events-none absolute -top-1.5 -bottom-1.5 -left-1.5 rounded-lg border-2 ${outline} ${broken ? "w-[10.25rem]" : "w-[14.4rem]"}`}
          />
          <span
            key={`l-${tone}`}
            className={`reveal-step absolute -top-6 left-0 rounded px-1.5 py-0.5 font-mono text-[0.58rem] font-medium text-white ${tone === "fail" ? "bg-fail" : tone === "pass" ? "bg-pass" : "bg-ribbon-blue"}`}
          >
            {label}
          </span>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-3 gap-y-1 text-[0.6rem] text-[#3b4fd8]/80">
          <span>Profile</span>
          <span>Notifications</span>
          <span>Active sessions</span>
          <span>API tokens</span>
        </div>
      </div>
      <figcaption className="sr-only">
        {broken
          ? "The Save button covers the team seats count."
          : "Save sits beside the team seats count."}
      </figcaption>
    </figure>
  );
}

/** What the demo's repair changes in the served page (the fixture's defect toggle). */
function RepairDiff() {
  return (
    <div className="animate-reveal overflow-hidden rounded-xl border bg-card font-mono text-[0.7rem] leading-6 shadow-sm">
      <div className="flex items-center justify-between border-b px-3 py-2 text-muted-foreground">
        <span>demo website · /settings</span>
        <span className="text-[0.62rem]">1 change</span>
      </div>
      <div className="py-2">
        <p className="bg-fail/10 px-3 text-fail">
          <span className="mr-3 select-none opacity-60">−</span>&lt;body
          class=&quot;layout-defect&quot;&gt;
        </p>
        <p className="bg-pass/10 px-3 text-pass">
          <span className="mr-3 select-none opacity-60">+</span>&lt;body&gt;
        </p>
        <p className="mt-2 px-3 text-muted-foreground/70">
          <span className="mr-3 select-none opacity-0">·</span>/* .layout-defect #save-settings{" "}
          {"{"}
        </p>
        <p className="px-3 text-muted-foreground/70">
          <span className="mr-3 select-none opacity-0">·</span>
          {"   "}position: absolute; inset-inline-end: 0 {"}"} */
        </p>
      </div>
      <p className="border-t px-3 py-2.5 font-sans text-xs leading-relaxed text-muted-foreground">
        The Test stays exactly the same. Only the website changed.
      </p>
    </div>
  );
}
