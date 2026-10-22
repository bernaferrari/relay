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

const logs: Record<Phase, string> = {
  record: "Recording: add the kettle to the cart and check out",
  fail: "Failed at step 4: Pay now covers the order total.",
  repair: "Fixed the stylesheet. The Test stays exactly the same.",
  pass: "Passed in 2.5 s. The checkout screenshot is waiting for your review.",
};

const steps = [
  { label: "Tap “Add to cart”", ms: "608ms" },
  { label: "Tap “Checkout”", ms: "254ms" },
  { label: "See “Order total”", ms: "41ms" },
  { label: "Check · Pay now doesn’t cover the total", ms: "60ms", check: true },
  { label: "Screenshot · Checkout", ms: "221ms" },
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
      <div role="group" aria-label="Run stage" className="mb-4 grid grid-cols-4 gap-1.5 sm:gap-2">
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
              Checkout · Pay button
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
                  : step.check && phase === "fail"
                    ? "failed"
                    : step.check && phase === "repair"
                      ? "fixing"
                      : i === 4 && (phase === "fail" || phase === "repair")
                        ? "skipped"
                        : "passed";
              return (
                <li
                  key={step.label}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[0.8rem] transition-colors duration-500 ${state === "failed" ? "bg-fail/10" : state === "fixing" ? "bg-ribbon-orange/10" : ""}`}
                >
                  <StepIcon state={state} />
                  <span
                    className={`min-w-0 flex-1 truncate ${state === "pending" || state === "skipped" ? "text-muted-foreground" : ""}`}
                  >
                    {step.label}
                  </span>
                  <span className="font-mono text-[0.68rem] tabular-nums text-muted-foreground">
                    {state === "fixing"
                      ? "fix"
                      : state === "passed" || state === "failed"
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
            {/* One window for every phase, so nothing jumps: the repair happens inside it. */}
            <CheckoutFrame broken={broken} phase={phase} />
          </div>
        </div>

        <div className="flex items-start gap-3 border-t bg-ink px-4 py-3 font-mono text-[0.72rem] leading-relaxed text-ink-foreground/80 sm:px-5">
          <span className="select-none text-ribbon-orange">$</span>
          <p aria-live="polite" key={phase} className="animate-reveal min-w-0">
            <span className="text-ink-foreground/45">relay · </span>
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
  if (state === "fixing")
    return (
      <span
        className={`${base} bg-ribbon-orange/20 text-[color-mix(in_oklch,var(--ribbon-orange)_80%,var(--foreground))]`}
      >
        <Wrench className="size-3" strokeWidth={2.5} />
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

/** A sketch of a store checkout; the bug is Pay now sliding over the order total. */
function CheckoutFrame({ broken, phase }: { broken: boolean; phase: Phase }) {
  const tone =
    phase === "fail" ? "fail" : phase === "pass" ? "pass" : phase === "repair" ? "fix" : "blue";
  const outline = {
    fail: "border-fail bg-fail/8",
    pass: "border-pass bg-pass/8",
    fix: "border-ribbon-orange border-dashed bg-ribbon-orange/8",
    blue: "border-ribbon-blue border-dashed bg-ribbon-blue/6",
  }[tone];
  const label = {
    fail: "Pay now covers the total",
    pass: "No overlap",
    fix: "Fixing the overlap",
    blue: "Check: no overlap",
  }[tone];
  return (
    <figure className="relative m-0 overflow-hidden rounded-xl border bg-[#f5f3ef] text-[#1c1917] shadow-sm dark:border-white/10">
      <div className="flex items-center gap-2 border-b border-black/8 bg-[#f6f6f4] px-3 py-2">
        <span className="flex gap-1">
          <i className="size-2 rounded-full bg-black/12" />
          <i className="size-2 rounded-full bg-black/12" />
          <i className="size-2 rounded-full bg-black/12" />
        </span>
        <span className="mx-auto rounded bg-white px-2 py-0.5 font-mono text-[0.62rem] text-black/50">
          shop.example/checkout
        </span>
      </div>
      <div className="flex items-center justify-between border-b border-black/6 bg-white px-5 py-2">
        <span className="text-[0.7rem] font-bold tracking-tight">
          Ember<span className="text-[#c2410c]">.</span>
        </span>
        <span className="flex gap-3 text-[0.55rem] text-black/45">
          <span>Shop</span>
          <span>Journal</span>
          <span>Cart</span>
        </span>
      </div>
      <div className="m-4 rounded-xl border border-black/8 bg-white px-4 pt-4 pb-5">
        <p className="text-base font-bold tracking-tight">Checkout</p>
        <p className="text-[0.62rem] text-black/50">Ember pour-over kettle · Free shipping</p>
        <div className="mt-2 flex justify-between border-b border-black/6 py-1.5 text-[0.62rem]">
          <span>Card</span>
          <span className="text-black/50">Visa ending 4242</span>
        </div>
        <div className="relative mt-8">
          <div className="relative flex h-10 items-center rounded-lg border border-black/8 bg-[#faf9f7] px-3 text-[0.62rem]">
            <span className="w-16 shrink-0 text-black/50">Order total</span>
            <b className="text-sm">$48.00</b>
            <span
              className={`ms-auto h-7 rounded-md bg-[#c2410c] px-3 text-[0.62rem] leading-7 font-semibold text-white transition-opacity duration-500 ${broken ? "opacity-0" : "opacity-100"}`}
            >
              Pay now
            </span>
            <span
              aria-hidden={!broken}
              className={`absolute top-1/2 left-[5.6rem] h-7 -translate-y-1/2 rounded-md bg-[#c2410c] px-3 text-[0.62rem] leading-7 font-semibold text-white shadow transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${broken ? "opacity-100" : "translate-x-24 opacity-0"}`}
            >
              Pay now
            </span>
          </div>
          <div
            key={tone}
            className={`reveal-step pointer-events-none absolute -inset-1.5 rounded-xl border-2 ${outline}`}
          />
          <span
            key={`l-${tone}`}
            className={`reveal-step absolute -top-6 left-0 rounded px-1.5 py-0.5 font-mono text-[0.58rem] font-medium text-white ${tone === "fail" ? "bg-fail" : tone === "pass" ? "bg-pass" : tone === "fix" ? "bg-ribbon-orange" : "bg-ribbon-blue"}`}
          >
            {label}
          </span>
        </div>
      </div>
      {/* The one-line fix floats over the page instead of replacing it. */}
      <div
        aria-hidden={phase !== "repair"}
        className={`absolute top-[4.5rem] right-6 overflow-hidden rounded-lg border border-black/10 bg-[#0f1220] font-mono text-[0.62rem] leading-5 shadow-lg transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${phase === "repair" ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
      >
        <p className="border-b border-white/10 px-2.5 py-1 text-white/45">
          checkout.css · 1 change
        </p>
        <p className="bg-[#ff5d5d]/15 px-2.5 text-[#ff9b9b]">
          − .pay {"{"} position: absolute; {"}"}
        </p>
        <p className="bg-[#3ddc84]/15 px-2.5 text-[#8ff0b7]">
          + .pay {"{"} margin-left: auto; {"}"}
        </p>
      </div>
      <figcaption className="sr-only">
        {broken
          ? "The Pay now button covers the order total."
          : "Pay now sits beside the order total."}
      </figcaption>
    </figure>
  );
}
