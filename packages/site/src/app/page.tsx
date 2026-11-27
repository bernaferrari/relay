import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Plus } from "lucide-react";
import { buttonVariants } from "@relay/ui-react/components/button";
import { SiteHeader } from "@/components/site-header";
import { ProductShowcase } from "@/components/product-showcase";
import { SiteFooter } from "@/components/site-footer";
import { RunReel } from "@/components/run-reel";
import { AgentConsole } from "@/components/agent-console";
import { GitHubMark } from "@/components/github-mark";
import { CopyExampleCommand } from "@/components/site-controls";
import { repositoryUrl } from "@/lib/site";

const container = "mx-auto w-full max-w-page px-5 sm:px-8";
const eyebrow = "font-mono text-eyebrow font-medium uppercase";
const h2 = "font-display text-headline font-semibold sm:text-headline-wide";
const lede = "text-lede leading-relaxed text-muted-foreground";
const textLink =
  "group inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline";
const inkButton =
  "h-12 rounded-full bg-ink px-6 text-quiet text-ink-foreground hover:bg-ink/85 dark:bg-ink-foreground dark:text-ink dark:hover:bg-ink-foreground/90";
const quietButton = "h-12 rounded-full bg-card px-5 text-quiet";

const startCommands = ["npx -y @relay/cli", "claude mcp add relay -- npx -y @relay/mcp"];

const faqs = [
  {
    question: "Do I need a model key?",
    answer: (
      <>
        Not for recorded steps, which replay deterministically at $0 model cost. Describing a test
        in plain English and model-assisted actions do need one.{" "}
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
        Yes. Relay is MIT licensed and runs locally. Model providers may charge for model-assisted
        actions. <Link href="/docs/getting-started/first-test">Create your first test</Link>; a
        recorded flow needs no key.
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
        <StorySection />
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
      <div aria-hidden className="paper-grid pointer-events-none absolute inset-0 fade-hero" />
      <div
        className={`${container} relative grid items-center gap-6 pt-14 pb-10 sm:pt-20 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:gap-4 lg:pt-24 lg:pb-16`}
      >
        <div className="relative z-10">
          <a
            href={repositoryUrl}
            className="inline-flex items-center gap-2 rounded-full border bg-card/80 py-1 ps-1 pe-3 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
          >
            <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-tiny text-ink-foreground dark:bg-ink-foreground dark:text-ink">
              MIT
            </span>
            Open source · local-first · no metered devices
            <ArrowUpRight className="size-3" />
          </a>
          <h1 className="mt-7 font-display text-hero font-semibold lg:text-hero-wide">
            <span className="block sm:whitespace-nowrap">Real eyes and hands</span>
            <span className="ribbon-text block pe-1 pb-1 sm:whitespace-nowrap">
              for coding agents.
            </span>
          </h1>
          <p className={`${lede} mt-7 max-w-136 sm:text-lede-wide`}>
            Relay lets Claude Code, Cursor, and Codex see and operate your web app, Android device,
            or iPhone. Keep Tests in Git as plain-English YAML; recorded interactions replay
            deterministically at $0 model cost.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/docs/agents/mcp" className={buttonVariants({ className: inkButton })}>
              Connect your agent <ArrowRight className="size-4" />
            </Link>
            <a
              href={repositoryUrl}
              className={buttonVariants({ variant: "outline", className: quietButton })}
            >
              <GitHubMark /> View source
            </a>
          </div>
          <p className="mt-5 flex items-center gap-2 text-step text-muted-foreground">
            <Check className="size-3.5 text-pass" strokeWidth={3} />
            Runs against localhost and USB devices. No Relay account, no metered device minutes.
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
    <div className="relative mx-auto aspect-square w-full max-w-88 sm:max-w-112 lg:max-w-none">
      <div
        aria-hidden
        className="absolute loop-halo-inset rounded-full opacity-60 blur-loop ribbon-glow dark:opacity-45"
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
        detail="write or record"
      />
      <LoopTag
        className="right-[-2%] loop-tag-baseline sm:right-[0%]"
        tone="orange"
        label="Your agent"
        detail="runs the proof"
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
      className={`absolute flex items-center gap-2 rounded-full border bg-card/90 py-1.5 ps-1.5 pe-3.5 text-xs shadow-float backdrop-blur-md ${className}`}
    >
      <span
        className={`size-5 rounded-full ${tone === "blue" ? "bg-ribbon-blue" : "bg-ribbon-orange"} shadow-gloss`}
      />
      <span className="font-semibold">{label}</span>
      <span className="text-muted-foreground">{detail}</span>
    </span>
  );
}

function StorySection() {
  return (
    <section id="story" className={`${container} scroll-mt-24 pt-10 pb-24 sm:pt-16 sm:pb-32`}>
      <div className="mb-10 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className={`${eyebrow} text-ribbon-blue`}>One test, four beats</p>
          <h2 className={`${h2} mt-4 max-w-[16ch]`}>Catch a bug. Prove the repair.</h2>
        </div>
        <p className={`${lede} max-w-sm md:text-right`}>
          Your agent changes checkout. When Pay now slides over the total, the saved Test fails;
          after the repair, the same Test proves the fix.
        </p>
      </div>
      <RunReel />
    </section>
  );
}

const loop = [
  {
    n: "01",
    title: "Write or record",
    line: "A Test starts as plain-English YAML.",
    body: "Write steps by hand, let your agent draft them, or record exact interactions in the app. Git can review the file.",
    href: "/docs/agents/test-files",
    cta: "Tests as YAML",
    visual: <RecordVisual />,
  },
  {
    n: "02",
    title: "Run",
    line: "Recorded steps replay deterministically.",
    body: "Run the saved Test on a local browser, an Android phone or emulator, or an iPhone or simulator. Exact replay uses no model.",
    href: "/docs/workflows/running",
    cta: "Running tests",
    visual: <ReplayVisual />,
  },
  {
    n: "03",
    title: "Review",
    line: "Every Run keeps evidence.",
    body: "Inspect what the Run expected and saw, with screenshots attached. Accept what looks right, flag what doesn't, and keep the decision with the Run.",
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
          <h2 className={`${h2} mt-4`}>Write. Run. Review.</h2>
          <p className={`${lede} mt-5 max-w-xl`}>
            Point Relay at an App, keep each Test in Git, inspect every Run, and let the Map connect
            the screens your evidence reaches.
          </p>
        </div>

        <div className="relative mt-16">
          <div
            aria-hidden
            className="ribbon-line absolute top-4.5 right-0 left-0 hidden h-px opacity-50 md:block"
          />
          <div className="grid gap-14 md:grid-cols-3 md:gap-8">
            {loop.map((item) => (
              <article key={item.n} className="relative">
                <span className="relative grid size-9 place-items-center rounded-full border bg-background font-mono text-xs font-medium shadow-sm">
                  {item.n}
                </span>
                <h3 className="mt-6 font-display text-feature font-semibold tracking-display">
                  {item.title}
                </h3>
                <div className="mt-5 h-52 overflow-hidden rounded-2xl border bg-background p-4">
                  {item.visual}
                </div>
                <p className="mt-6 font-medium tracking-tight">{item.line}</p>
                <p className="mt-2 text-quiet leading-relaxed text-muted-foreground">{item.body}</p>
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
  const rows = ["Tap “Add to cart”", "Tap “Checkout”", "See “Order total”"];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-fail/10 px-2 py-0.5 font-mono text-tiny text-fail">
          <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
          REC 00:14
        </span>
        <span className="font-mono text-tiny text-muted-foreground">3 steps · 1 check</span>
      </div>
      <ol className="mt-3.5 space-y-1.5 text-step">
        {rows.map((row) => (
          <li key={row} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5">
            <span className="size-1.5 rounded-full bg-ribbon-blue" />
            {row}
          </li>
        ))}
        <li className="flex items-center gap-2 rounded-md border border-dashed border-ribbon-blue/60 bg-ribbon-blue/5 px-2.5 py-1.5 text-ribbon-blue">
          <Plus className="size-3" /> Check: Pay now doesn’t cover the total
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
          <span className="font-mono text-tiny text-muted-foreground">{d.name}</span>
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
          <span className={`font-mono text-tiny ${f.tone}`}>{f.state}</span>
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
        className="pointer-events-none absolute top-1/2 right-[-10%] h-144 w-192 -translate-y-1/2 rounded-full opacity-30 blur-ambient ember-glow"
      />
      <div
        className={`${container} relative grid gap-14 py-24 sm:py-32 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center`}
      >
        <div>
          <p className={`${eyebrow} text-ribbon-orange`}>For coding agents</p>
          <h2 className={`${h2} mt-4`}>Close the loop without leaving the editor.</h2>
          <p className="mt-6 max-w-lg text-lede leading-relaxed text-ink-foreground/65">
            Claude Code, Cursor, and Codex can drive the same Tests through MCP or the CLI. An agent
            reruns a flow, reads what was expected and what it saw, repairs the cause, and runs it
            again. Then you review the exact Run it made.
          </p>
          <ul className="mt-9 space-y-4 text-quiet">
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
      v: "Your browser, your Android phone or emulator, your iPhone or simulator. No rented device minutes.",
    },
    {
      k: "Your workspace",
      v: "Tests, Runs, and screenshots stay on your machine. Model-assisted steps send only what they need to the provider you choose.",
    },
    {
      k: "Your code",
      v: "MIT licensed. Read it, change it, inspect exactly what your agent is driving.",
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
            <h3 className="mt-6 font-display text-2xl font-semibold tracking-display">{fact.k}</h3>
            <p className="mt-3 text-quiet leading-relaxed text-muted-foreground">{fact.v}</p>
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
          <h2 className={`${h2} mt-4`}>Two commands. Then your agent can verify.</h2>
          <p className={`${lede} mt-6 max-w-md`}>
            Use the npx packages for the zero-friction path: run Relay locally, then register its
            MCP server with Claude Code. Cursor and Codex can launch the same package through their
            MCP settings.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {["Node.js 24+", "A local browser", "USB devices optional", "No Relay account"].map(
              (req) => (
                <li
                  key={req}
                  className="rounded-full border bg-background px-3 py-1 font-mono text-data text-muted-foreground"
                >
                  {req}
                </li>
              ),
            )}
          </ul>
          <Link href="/docs/getting-started/first-test" className={`${textLink} mt-6`}>
            Read the walkthrough{" "}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <p className="mt-4 max-w-md text-step leading-relaxed text-muted-foreground">
            Building from source instead? Clone the repository, run{" "}
            <code className="font-mono text-foreground">pnpm run agent-device:install</code> and{" "}
            <code className="font-mono text-foreground">pnpm run agent-device:build</code>, then{" "}
            <code className="font-mono text-foreground">vp install</code> and{" "}
            <code className="font-mono text-foreground">pnpm dev:web</code>.
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border bg-ink text-ink-foreground shadow-terminal">
          <div className="flex items-center justify-between border-b border-white/10 py-1.5 ps-4 pe-1">
            <span className="flex gap-1.5">
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/15" />
            </span>
            <span className="font-mono text-eyebrow text-white/40">zero-friction path</span>
            <span className="[&_button]:text-white/60 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
              <CopyExampleCommand text={startCommands.join("\n")} />
            </span>
          </div>
          <div className="overflow-x-auto p-5 font-mono text-step leading-7 sm:p-6">
            {startCommands.map((cmd) => (
              <p key={cmd} className="whitespace-nowrap">
                <span className="mr-2 select-none text-ribbon-orange">$</span>
                {cmd}
              </p>
            ))}
            <div className="mt-3 border-t border-white/10 pt-3 text-xs leading-6">
              <p className="ps-4 -indent-4 text-white/50">
                → No clone, no Relay account, no metered device minutes
              </p>
              <p className="ps-4 -indent-4 text-white/50">
                → New Test · enter localhost or attach a device · write or record the flow
              </p>
              <p className="ps-4 -indent-4 text-pass">
                ✓ Your agent can rerun it, inspect the verdict, and prove the fix.
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
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 text-lede font-medium tracking-tight [&::-webkit-details-marker]:hidden">
              {question}
              <span className="grid size-8 shrink-0 place-items-center rounded-full border text-muted-foreground transition-transform duration-200 group-open:rotate-45">
                <Plus className="size-4" />
              </span>
            </summary>
            <p className="max-w-[62ch] pb-6 text-quiet leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
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
      <div className="relative overflow-hidden rounded-banner border bg-card px-7 py-14 sm:px-14 sm:py-20">
        <div aria-hidden className="paper-grid pointer-events-none absolute inset-0 fade-left" />
        {/* The loop gets its own column: it never sits behind the words. */}
        <div className="relative grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="relative max-w-xl">
            <h2 className={h2}>
              Let your agent <span className="ribbon-text">prove the fix.</span>
            </h2>
            <p className={`${lede} mt-5 max-w-md`}>
              Connect Relay, choose one journey that matters, and make the next repair come back
              with evidence.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/docs/agents/mcp" className={buttonVariants({ className: inkButton })}>
                Connect your agent <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/docs"
                className={buttonVariants({ variant: "outline", className: quietButton })}
              >
                Read the docs
              </Link>
            </div>
          </div>
          <Image
            src="/relay-loop.webp"
            alt=""
            width={1024}
            height={1024}
            aria-hidden
            className="animate-loop-drift pointer-events-none mx-auto w-52 select-none sm:w-64 md:-my-10 md:w-full motion-reduce:animate-none"
          />
        </div>
      </div>
    </section>
  );
}
