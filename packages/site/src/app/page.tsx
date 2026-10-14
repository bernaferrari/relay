import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Plus } from "lucide-react";
import { buttonVariants } from "@relay/ui-react/components/button";
import { SiteHeader } from "@/components/site-header";
import { RelayBrand } from "@/components/relay-brand";
import { ProductShowcase } from "@/components/product-showcase";
import { RunReel } from "@/components/run-reel";
import { AgentConsole } from "@/components/agent-console";
import { GitHubMark } from "@/components/github-mark";
import { CopyExampleCommand } from "@/components/site-controls";
import { repositoryUrl } from "@/lib/site";

const container = "mx-auto w-full max-w-[1200px] px-5 sm:px-8";
const eyebrow = "font-mono text-[0.7rem] font-medium tracking-[0.14em] uppercase";
const h2 =
  "font-display text-[2.35rem] leading-[1.04] font-semibold tracking-[-0.028em] sm:text-[3.3rem]";
const lede = "text-[1.05rem] leading-relaxed text-muted-foreground";
const textLink =
  "group inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline";
const inkButton =
  "h-12 rounded-full bg-ink px-6 text-[0.95rem] text-ink-foreground hover:bg-ink/85 dark:bg-ink-foreground dark:text-ink dark:hover:bg-ink-foreground/90";
const quietButton = "h-12 rounded-full bg-card px-5 text-[0.95rem]";

const demoCommands = [
  "git clone https://github.com/bernaferrari/relay.git",
  "cd relay && pnpm install",
  "pnpm ensure:serve",
  "pnpm demo",
];

const faqs = [
  {
    question: "Do I need a model key?",
    answer: (
      <>
        Not for the demo or for recorded steps, which replay deterministically. Describing a test in
        plain English and model-assisted actions do need one.{" "}
        <Link href="/docs/getting-started/installation">The setup guide</Link> explains both paths.
      </>
    ),
  },
  {
    question: "Can I test a real phone or tablet?",
    answer: (
      <>
        Yes. Relay supports browsers, Android devices and emulators, and iOS devices and simulators.
        Android needs adb; iOS needs a Mac with Xcode. Read the{" "}
        <Link href="/docs/devices/android">Android</Link> and{" "}
        <Link href="/docs/devices/ios">iOS</Link> guides for prerequisites and current limitations.
      </>
    ),
  },
  {
    question: "Where does my data go?",
    answer: (
      <>
        Tests, runs, and screenshots stay in your local workspace. Model-assisted actions send the
        input they need to the model provider you configure. You control optional evidence
        collection in <Link href="/docs/reference/evidence">Evidence & privacy</Link>.
      </>
    ),
  },
  {
    question: "Can I use my existing e2e tests?",
    answer: (
      <>
        As a pilot, yes, for web engines. Relay runs your original e2e project, keeps its result
        unchanged, and adds screenshot review around it.{" "}
        <Link href="/docs/agents/e2e">See the supported scope.</Link>
      </>
    ),
  },
  {
    question: "Is Relay free and open source?",
    answer: (
      <>
        Yes. Relay is MIT licensed, and you can run it from source today. Model providers may charge
        for model-assisted actions.{" "}
        <Link href="/docs/getting-started/first-test">Start with the demo</Link>, no key required.
      </>
    ),
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="overflow-x-clip">
        <Hero />
        <DemoSection />
        <LoopSection />
        <AgentsSection />
        <LocalSection />
        <QuickstartSection />
        <FaqSection />
        <ClosingSection />
      </main>
      <SiteFooter />
    </>
  );
}

function Hero() {
  return (
    <section className="relative">
      <div
        aria-hidden
        className="paper-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_70%_35%,black,transparent)]"
      />
      <div
        className={`${container} relative grid items-center gap-6 pt-14 pb-10 sm:pt-20 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:gap-4 lg:pt-24 lg:pb-16`}
      >
        <div className="relative z-10">
          <a
            href={repositoryUrl}
            className="inline-flex items-center gap-2 rounded-full border bg-card/80 py-1 ps-1 pe-3 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
          >
            <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-[0.65rem] text-ink-foreground dark:bg-ink-foreground dark:text-ink">
              MIT
            </span>
            Open source · runs on your machine
            <ArrowUpRight className="size-3" />
          </a>
          <h1 className="mt-7 font-display text-[clamp(2.7rem,10vw,4rem)] leading-[0.98] font-semibold tracking-[-0.034em] lg:text-[clamp(4rem,5.3vw,4.85rem)]">
            <span className="block sm:whitespace-nowrap">Click through it once.</span>
            <span className="ribbon-text block pe-1 pb-1 sm:whitespace-nowrap">
              Relay keeps checking.
            </span>
          </h1>
          <p className={`${lede} mt-7 max-w-[34rem] sm:text-[1.15rem]`}>
            Record a test just by using your website or mobile app. Relay replays it on your own
            browser, Android, or iOS device, and keeps a screenshot of every step. Works the same
            whether you press record or your coding agent does.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/docs/getting-started/first-test"
              className={buttonVariants({ className: inkButton })}
            >
              Run the demo <ArrowRight className="size-4" />
            </Link>
            <a
              href={repositoryUrl}
              className={buttonVariants({ variant: "outline", className: quietButton })}
            >
              <GitHubMark /> View source
            </a>
          </div>
          <p className="mt-5 flex items-center gap-2 text-[0.8rem] text-muted-foreground">
            <Check className="size-3.5 text-pass" strokeWidth={3} />
            The demo runs locally. No model key, no account.
          </p>
        </div>
        <HeroLoop />
      </div>
    </section>
  );
}

/** The icon is the brand: two ribbons, one loop. Blue is you; orange is your agent. */
function HeroLoop() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[22rem] sm:max-w-[28rem] lg:max-w-none">
      <div
        aria-hidden
        className="absolute inset-[14%] rounded-full opacity-60 blur-[70px] [background:conic-gradient(from_200deg,var(--ribbon-blue),var(--ribbon-violet),var(--ribbon-pink),var(--ribbon-orange),var(--ribbon-blue))] dark:opacity-45"
      />
      <Image
        src="/relay-loop.webp"
        alt="Relay's loop: a blue ribbon and an orange ribbon twisted into one"
        width={1024}
        height={1024}
        priority
        sizes="(min-width: 1024px) 520px, 90vw"
        className="animate-loop-drift relative h-full w-full object-contain motion-reduce:animate-none"
      />
      <LoopTag
        className="top-[17%] left-[-2%] sm:left-[2%]"
        tone="blue"
        label="You"
        detail="record a flow"
      />
      <LoopTag
        className="right-[-2%] bottom-[16%] sm:right-[0%]"
        tone="orange"
        label="Your agent"
        detail="reruns it"
      />
    </div>
  );
}

function LoopTag({
  className,
  tone,
  label,
  detail,
}: {
  className: string;
  tone: "blue" | "orange";
  label: string;
  detail: string;
}) {
  return (
    <span
      className={`absolute flex items-center gap-2 rounded-full border bg-card/90 py-1.5 ps-1.5 pe-3.5 text-xs shadow-[0_8px_30px_-12px_rgb(0_0_0/0.25)] backdrop-blur-md ${className}`}
    >
      <span
        className={`size-5 rounded-full ${tone === "blue" ? "bg-ribbon-blue" : "bg-ribbon-orange"} shadow-[inset_0_-2px_4px_rgb(0_0_0/0.2),inset_0_2px_3px_rgb(255_255_255/0.5)]`}
      />
      <span className="font-semibold">{label}</span>
      <span className="text-muted-foreground">{detail}</span>
    </span>
  );
}

function DemoSection() {
  return (
    <section id="demo" className={`${container} scroll-mt-24 pt-10 pb-24 sm:pt-16 sm:pb-32`}>
      <div className="mb-10 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className={`${eyebrow} text-ribbon-blue`}>The demo, in four beats</p>
          <h2 className={`${h2} mt-4 max-w-[16ch]`}>Catch a bug. Prove the repair.</h2>
        </div>
        <p className={`${lede} max-w-sm md:text-right`}>
          The demo website ships with a real layout bug. Relay records a check, catches the bug, and
          then reruns the same saved test to prove the fix.
        </p>
      </div>
      <RunReel />
    </section>
  );
}

const loop = [
  {
    n: "01",
    title: "Record",
    line: "Use your app. Relay writes the steps.",
    body: "Click through a website or a mobile app. Keep the steps that matter, then add checks for what has to stay true.",
    href: "/docs/workflows/recording",
    cta: "Recording guide",
    visual: <RecordVisual />,
  },
  {
    n: "02",
    title: "Replay",
    line: "Same steps, on your devices.",
    body: "Run the saved test on a local browser, an Android phone or emulator, or an iPhone or simulator.",
    href: "/docs/workflows/running",
    cta: "Running tests",
    visual: <ReplayVisual />,
  },
  {
    n: "03",
    title: "Review",
    line: "Every screen, kept as evidence.",
    body: "Inspect what each run saw. Accept what looks right, flag what doesn't, and keep the decision with the run.",
    href: "/docs/workflows/review",
    cta: "Screenshot review",
    visual: <ReviewVisual />,
  },
];

function LoopSection() {
  return (
    <section id="loop" className="scroll-mt-16 border-t bg-card/60">
      <div className={`${container} py-24 sm:py-32`}>
        <div className="max-w-2xl">
          <p className={`${eyebrow} text-ribbon-violet`}>How it works</p>
          <h2 className={`${h2} mt-4`}>One loop, kept honest.</h2>
          <p className={`${lede} mt-5 max-w-xl`}>
            Record what you do, replay it whenever something changes, and decide with screenshots in
            front of you, not a hunch.
          </p>
        </div>

        <div className="relative mt-16">
          <div
            aria-hidden
            className="ribbon-line absolute top-[1.125rem] right-0 left-0 hidden h-px opacity-50 md:block"
          />
          <div className="grid gap-14 md:grid-cols-3 md:gap-8">
            {loop.map((item) => (
              <article key={item.n} className="relative">
                <span className="relative grid size-9 place-items-center rounded-full border bg-background font-mono text-xs font-medium shadow-sm">
                  {item.n}
                </span>
                <h3 className="mt-6 font-display text-[1.75rem] font-semibold tracking-[-0.03em]">
                  {item.title}
                </h3>
                <div className="mt-5 h-52 overflow-hidden rounded-2xl border bg-background p-4">
                  {item.visual}
                </div>
                <p className="mt-6 font-medium tracking-tight">{item.line}</p>
                <p className="mt-2 text-[0.92rem] leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
                <Link href={item.href} className={`${textLink} mt-2`}>
                  {item.cta}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-24 sm:mt-28">
          <ProductShowcase />
        </div>
      </div>
    </section>
  );
}

function RecordVisual() {
  const rows = ["Tap “Continue as Member”", "Tap “Settings”", "See “Team seats”"];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-fail/10 px-2 py-0.5 font-mono text-[0.65rem] text-fail">
          <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
          REC 00:14
        </span>
        <span className="font-mono text-[0.65rem] text-muted-foreground">3 steps · 1 check</span>
      </div>
      <ol className="mt-3.5 space-y-1.5 text-[0.78rem]">
        {rows.map((row) => (
          <li key={row} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5">
            <span className="size-1.5 rounded-full bg-ribbon-blue" />
            {row}
          </li>
        ))}
        <li className="flex items-center gap-2 rounded-md border border-dashed border-ribbon-blue/60 bg-ribbon-blue/5 px-2.5 py-1.5 text-ribbon-blue">
          <Plus className="size-3" /> Check: Save and seats don’t overlap
        </li>
      </ol>
    </div>
  );
}

function ReplayVisual() {
  const devices = [
    { name: "Browser", w: "w-[46%]", h: "h-[72%]", r: "rounded-md" },
    { name: "Android", w: "w-[19%]", h: "h-[88%]", r: "rounded-xl" },
    { name: "iOS", w: "w-[19%]", h: "h-[88%]", r: "rounded-[0.9rem]" },
  ];
  return (
    <div className="flex h-full items-end justify-center gap-3 pb-1">
      {devices.map((d) => (
        <div key={d.name} className={`flex ${d.w} h-full flex-col items-center justify-end gap-2`}>
          <div className={`relative w-full ${d.h} ${d.r} border bg-card p-1.5 shadow-sm`}>
            <div className={`h-full w-full ${d.r} bg-muted/80 p-1.5`}>
              <div className="h-1 w-2/3 rounded-full bg-foreground/15" />
              <div className="mt-1 h-1 w-1/2 rounded-full bg-foreground/10" />
            </div>
            <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-pass text-white shadow">
              <Check className="size-3" strokeWidth={3} />
            </span>
          </div>
          <span className="font-mono text-[0.62rem] text-muted-foreground">{d.name}</span>
        </div>
      ))}
    </div>
  );
}

function ReviewVisual() {
  const frames = [
    { state: "Accepted", tone: "text-pass", ring: "" },
    { state: "Flagged", tone: "text-fail", ring: "ring-2 ring-fail/60" },
    { state: "Pending", tone: "text-muted-foreground", ring: "" },
  ];
  return (
    <div className="grid h-full grid-cols-3 gap-2.5">
      {frames.map((f, i) => (
        <div key={f.state} className="flex flex-col gap-2">
          <div
            className={`relative flex-1 overflow-hidden rounded-lg border bg-card p-2 ${f.ring}`}
          >
            <div className="h-1 w-3/4 rounded-full bg-foreground/20" />
            <div className="mt-1.5 h-1 w-1/2 rounded-full bg-foreground/10" />
            <div className="mt-3 flex gap-1">
              <div className="h-3.5 flex-1 rounded-sm border" />
              <div className={`h-3.5 w-5 rounded-sm bg-ribbon-blue/80 ${i === 1 ? "-ml-4" : ""}`} />
            </div>
            <div className="mt-2 space-y-1">
              <div className="h-1 w-full rounded-full bg-foreground/8" />
              <div className="h-1 w-5/6 rounded-full bg-foreground/8" />
            </div>
          </div>
          <span className={`font-mono text-[0.62rem] ${f.tone}`}>{f.state}</span>
        </div>
      ))}
    </div>
  );
}

function AgentsSection() {
  return (
    <section
      id="agents"
      className="relative scroll-mt-16 overflow-hidden bg-ink text-ink-foreground dark:border-y dark:border-white/[0.06]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-[-10%] h-[36rem] w-[48rem] -translate-y-1/2 rounded-full opacity-30 blur-[120px] [background:radial-gradient(closest-side,var(--ribbon-orange),var(--ribbon-pink)_45%,transparent)]"
      />
      <div
        className={`${container} relative grid gap-14 py-24 sm:py-32 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center`}
      >
        <div>
          <p className={`${eyebrow} text-ribbon-orange`}>For coding agents</p>
          <h2 className={`${h2} mt-4`}>Your agent gets the same buttons.</h2>
          <p className="mt-6 max-w-lg text-[1.05rem] leading-relaxed text-ink-foreground/65">
            The app, the CLI, and MCP all drive the same saved tests and the same runs. An agent can
            rerun a flow, read what was expected and what it saw, repair the cause, and run it
            again. Then you review the exact run it made.
          </p>
          <ul className="mt-9 space-y-4 text-[0.92rem]">
            {[
              [
                "Exit codes that mean something",
                "0 passed · 1 failed its expectation · 3 couldn’t run · 10 passed, review pending",
              ],
              [
                "Verdicts an agent can act on",
                "Each failed check reports what it expected and what it saw.",
              ],
              [
                "Checked before it touches a device",
                "The MCP doctor verifies service, scope, and tools first.",
              ],
            ].map(([title, detail]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ribbon-orange" />
                <span>
                  <span className="font-medium">{title}</span>
                  <span className="mt-0.5 block text-ink-foreground/55">{detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-9 flex flex-wrap gap-x-6">
            <Link href="/docs/agents/mcp" className={`${textLink} text-ink-foreground`}>
              Connect over MCP{" "}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/docs/agents/cli" className={`${textLink} text-ink-foreground`}>
              Use the CLI{" "}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        <AgentConsole />
      </div>
    </section>
  );
}

function LocalSection() {
  const facts = [
    {
      k: "Your devices",
      v: "Your browser, your Android phone or emulator, your iPhone or simulator. Nothing rented.",
    },
    {
      k: "Your workspace",
      v: "Tests, runs, and screenshots stay on your machine. Model-assisted steps send only what they need.",
    },
    {
      k: "Your code",
      v: "MIT licensed. Read it, change it, and run it from source today.",
    },
  ];
  return (
    <section className={`${container} py-24 sm:py-28`}>
      <div className="grid gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-3">
        {facts.map((fact, i) => (
          <div key={fact.k} className="bg-background p-7 sm:p-8">
            <span
              className={`block h-1 w-8 rounded-full ${["bg-ribbon-blue", "bg-ribbon-pink", "bg-ribbon-orange"][i]}`}
            />
            <h3 className="mt-6 font-display text-2xl font-semibold tracking-[-0.03em]">
              {fact.k}
            </h3>
            <p className="mt-3 text-[0.92rem] leading-relaxed text-muted-foreground">{fact.v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuickstartSection() {
  return (
    <section id="start" className="scroll-mt-16 border-t bg-card/60">
      <div
        className={`${container} grid gap-12 py-24 sm:py-32 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center`}
      >
        <div>
          <p className={`${eyebrow} text-ribbon-pink`}>Quickstart</p>
          <h2 className={`${h2} mt-4`}>Your first caught bug, in four commands.</h2>
          <p className={`${lede} mt-6 max-w-md`}>
            The demo starts a small website with a real layout bug, catches it, repairs it, and
            proves the repair with the same test. Then open the run in Relay and look for yourself.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {["Node.js 24+", "pnpm", "Git", "A local browser"].map((req) => (
              <li
                key={req}
                className="rounded-full border bg-background px-3 py-1 font-mono text-[0.72rem] text-muted-foreground"
              >
                {req}
              </li>
            ))}
          </ul>
          <Link href="/docs/getting-started/first-test" className={`${textLink} mt-6`}>
            Read the walkthrough{" "}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="overflow-hidden rounded-2xl border bg-ink text-ink-foreground shadow-[0_30px_70px_-35px_color-mix(in_oklch,var(--ribbon-pink)_45%,transparent)]">
          <div className="flex items-center justify-between border-b border-white/10 py-1.5 ps-4 pe-1">
            <span className="flex gap-1.5">
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/15" />
            </span>
            <span className="font-mono text-[0.68rem] text-white/40">~/relay</span>
            <span className="[&_button]:text-white/60 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
              <CopyExampleCommand text={demoCommands.join("\n")} />
            </span>
          </div>
          <div className="overflow-x-auto p-5 font-mono text-[0.78rem] leading-7 sm:p-6">
            {demoCommands.map((cmd) => (
              <p key={cmd} className="whitespace-nowrap">
                <span className="mr-2 select-none text-ribbon-orange">$</span>
                {cmd}
              </p>
            ))}
            <div className="mt-3 border-t border-white/10 pt-3 text-[0.74rem] leading-6">
              <p className="ps-4 -indent-4 text-fail">
                ✗ Caught the defect: Save overlaps the team seats (layout check failed).
              </p>
              <p className="ps-4 -indent-4 text-white/50">
                ↻ Repair: removed the overlap in this owned demo website; rerunning the unchanged
                Test.
              </p>
              <p className="ps-4 -indent-4 text-pass">
                ✓ Layout check passed. Screenshot review is pending; the demo makes no human
                decision.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section
      className={`${container} grid gap-10 py-24 sm:py-32 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]`}
    >
      <div className="lg:sticky lg:top-28 lg:self-start">
        <h2 className={h2}>Before your first run.</h2>
        <p className={`${lede} mt-5 max-w-sm`}>
          Model keys, real devices, your data, and what’s ready today.
        </p>
        <Link href="/docs/getting-started/installation" className={`${textLink} mt-4`}>
          Installation guide{" "}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="border-t">
        {faqs.map(({ question, answer }) => (
          <details key={question} className="group border-b">
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 text-[1.05rem] font-medium tracking-tight [&::-webkit-details-marker]:hidden">
              {question}
              <span className="grid size-8 shrink-0 place-items-center rounded-full border text-muted-foreground transition-transform duration-200 group-open:rotate-45">
                <Plus className="size-4" />
              </span>
            </summary>
            <p className="max-w-[62ch] pb-6 text-[0.95rem] leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
              {answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function ClosingSection() {
  return (
    <section className={`${container} pb-24 sm:pb-32`}>
      <div className="relative overflow-hidden rounded-[2rem] border bg-card px-7 py-14 sm:px-14 sm:py-20">
        <div
          aria-hidden
          className="paper-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_left,black,transparent_70%)]"
        />
        <Image
          src="/relay-loop.webp"
          alt=""
          width={1024}
          height={1024}
          aria-hidden
          className="animate-loop-drift pointer-events-none absolute -right-24 -bottom-28 w-[22rem] select-none sm:-right-10 sm:-bottom-20 sm:w-[30rem] motion-reduce:animate-none"
        />
        <div className="relative max-w-xl">
          <h2 className={h2}>
            Give one flow a <span className="ribbon-text">repeat button.</span>
          </h2>
          <p className={`${lede} mt-5 max-w-md`}>
            Start with the demo, then record the journey in your own app that you’re tired of
            clicking through by hand.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/docs/getting-started/first-test"
              className={buttonVariants({ className: inkButton })}
            >
              Run the demo <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/docs"
              className={buttonVariants({ variant: "outline", className: quietButton })}
            >
              Read the docs
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const columns = [
    {
      title: "Product",
      links: [
        ["How it works", "#loop"],
        ["For agents", "#agents"],
        ["Run the demo", "/docs/getting-started/first-test"],
      ],
    },
    {
      title: "Guides",
      links: [
        ["Install", "/docs/getting-started/installation"],
        ["Record a flow", "/docs/workflows/recording"],
        ["Connect over MCP", "/docs/agents/mcp"],
      ],
    },
    {
      title: "Project",
      links: [
        ["GitHub", repositoryUrl],
        ["Feedback", `${repositoryUrl}/issues`],
        ["MIT license", `${repositoryUrl}/blob/main/LICENSE`],
      ],
    },
  ];
  return (
    <footer className="border-t">
      <div className={`${container} grid gap-10 py-14 sm:grid-cols-[1.4fr_repeat(3,1fr)]`}>
        <div>
          <Link href="/" aria-label="Relay home" className="inline-flex rounded-md">
            <RelayBrand />
          </Link>
          <p className="mt-3 max-w-[16rem] text-sm leading-relaxed text-muted-foreground">
            Local QA, for people and agents.
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title} className="text-sm">
            <p className={`${eyebrow} text-muted-foreground`}>{col.title}</p>
            <ul className="mt-3">
              {col.links.map(([label, href]) => (
                <li key={label}>
                  <a
                    href={href}
                    className="inline-flex min-h-9 items-center text-foreground/80 hover:text-foreground"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
