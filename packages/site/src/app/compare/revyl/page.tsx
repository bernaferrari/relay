import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import { buttonVariants } from "@relay/ui-react/components/button";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { GitHubMark } from "@/components/github-mark";
import { CopyExampleCommand } from "@/components/site-controls";
import { repositoryUrl } from "@/lib/site";

const container = "mx-auto w-full max-w-page px-5 sm:px-8";
const eyebrow = "font-mono text-eyebrow font-medium uppercase";
const h2 = "font-display text-headline font-semibold sm:text-headline-wide";
const lede = "text-lede leading-relaxed text-muted-foreground";
const inkButton =
  "h-12 rounded-full bg-ink px-6 text-quiet text-ink-foreground hover:bg-ink/85 dark:bg-ink-foreground dark:text-ink dark:hover:bg-ink-foreground/90";
const quietButton = "h-12 rounded-full bg-card px-5 text-quiet";
const startCommands = ["npx -y @relay/cli", "claude mcp add relay -- npx -y @relay/mcp"];

export const metadata: Metadata = {
  title: { absolute: "Revyl alternative: Relay vs Revyl" },
  description:
    "An honest comparison of Revyl's managed cloud devices and Relay, the open-source local alternative for coding-agent verification on web, Android, and iOS.",
  alternates: { canonical: "/compare/revyl" },
  openGraph: {
    title: "Revyl alternative: Relay vs Revyl",
    description:
      "Where Revyl's cloud runtimes win, and where Relay's free, local, deterministic verification loop wins.",
    type: "article",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Relay: Real eyes and hands for coding agents.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Revyl alternative: Relay vs Revyl",
    description:
      "Where Revyl's cloud runtimes win, and where Relay's free, local, deterministic verification loop wins.",
    images: ["/og.png"],
  },
};

const revylWins = [
  "You need iOS in CI without owning or operating a Mac.",
  "You want pre-warmed cloud browsers, Android emulators, iOS simulators, or macOS desktops in seconds.",
  "You need parallelism beyond the phones, simulators, and machines you own.",
  "You want zero local device setup, hosted builds, browser-based sharing, or managed enterprise controls.",
  "Your team is comfortable sending app builds, runtime input, and artifacts to a cloud platform.",
];

const relayWins = [
  "Your agent needs one local loop across web, Android, and iOS — especially against localhost, a private network, or a USB device.",
  "You want free, MIT-licensed software with no Relay account and no metered device minutes.",
  "Tests should be plain-English YAML that can live in Git and be reviewed like code.",
  "Recorded interactions should replay deterministically at $0 model cost.",
  "Fail-closed verdicts and exact-once mutation safety matter when agents act on real apps.",
  "Tests, Runs, screenshots, and trace evidence should stay on your machine.",
];

const comparisonRows: { area: string; relay: string; revyl: string }[] = [
  {
    area: "Core model",
    relay: "Local verification workspace for coding agents and developers.",
    revyl: "Managed cloud platform for building, developing, and verifying apps.",
  },
  {
    area: "Runtimes",
    relay: "Your browser, Android device or emulator, and iPhone or simulator.",
    revyl: "Hosted web browsers, Android emulators, iOS simulators, and macOS computers.",
  },
  {
    area: "iOS without a Mac",
    relay: "No. iOS input requires local Apple platform tooling.",
    revyl: "Yes. Hosted iOS runtimes run on managed Mac infrastructure.",
  },
  {
    area: "Parallelism",
    relay: "Bounded by your machines, devices, and emulators.",
    revyl:
      "Cloud-side sessions; public plans advertise 2 concurrent devices on Free, 10 on Pro, and unlimited devices on Enterprise.",
  },
  {
    area: "Setup",
    relay:
      "Node.js plus the platform tools for the targets you use: a browser, adb, or macOS with Xcode.",
    revyl: "Account-based hosted setup; no local Xcode or Android Studio for cloud runs.",
  },
  {
    area: "Cost model",
    relay:
      "Free and MIT licensed. Model-assisted authoring or actions use the model provider you choose.",
    revyl: "A monthly free allowance, then metered per-minute usage; Enterprise pricing is custom.",
  },
  {
    area: "Replay behavior",
    relay:
      "Recorded or bound interactions replay deterministically with no model call. Newly written plain-English steps need recording, binding, or a model-assisted path.",
    revyl:
      "Agentic natural-language workflows execute in managed runtimes. Revyl says AI usage draws from the same allowance.",
  },
  {
    area: "Data boundary",
    relay:
      "Tests, Runs, screenshots, and evidence stay in the local workspace. Model-assisted steps send their required input to your chosen provider.",
    revyl:
      "App builds, runtime input, results, and artifacts are processed in Revyl's cloud; Enterprise adds managed compliance and networking options.",
  },
  {
    area: "Evidence",
    relay:
      "Expected-vs-saw verdicts, step screenshots, review state, and content-addressed trace packs.",
    revyl:
      "Video replay, step timelines, screenshots, logs, device metadata, performance data, and shareable reports.",
  },
  {
    area: "Source of truth",
    relay: "Plain-English YAML Tests can be exported, applied, and reviewed in Git.",
    revyl: "Workflows are managed through the hosted platform, with CLI, API, and CI integration.",
  },
  {
    area: "Extensibility",
    relay: "MIT source you can inspect, modify, and run yourself.",
    revyl: "A managed service with public APIs, CLI, integrations, and Enterprise options.",
  },
];

const faqs = [
  {
    question: "Is Relay a drop-in Revyl replacement?",
    answer:
      "No. If your hard requirement is instant hosted devices, cloud parallelism, or iOS without a Mac, Revyl is the better fit. If your requirement is a local, inspectable verification loop for coding agents, Relay is the better fit.",
  },
  {
    question: "Is Relay really free?",
    answer:
      "Relay is MIT licensed and does not meter local runs or devices. You supply the machine and devices. Model-assisted authoring, exploration, or actions can cost money through the model provider you configure; recorded deterministic replay does not call a model.",
  },
  {
    question: "Can Relay run iOS tests from Linux or Windows CI?",
    answer:
      "No. Relay's iOS support depends on local Apple platform tooling. Use a Mac runner you control, or choose a hosted platform such as Revyl when non-Mac CI is the constraint.",
  },
  {
    question: "Can Relay test localhost or a USB phone?",
    answer:
      "Yes. That is the local-first path Relay is designed for: development servers on localhost or private networks, browsers on the same machine, and Android or iOS devices you control.",
  },
  {
    question: "Does deterministic replay mean Relay never uses a model?",
    answer:
      "No. Describing new tests, exploration, and model-assisted actions can use a model. Recorded or otherwise bound interactions replay deterministically at $0 model cost. Relay is explicit about which path a step uses.",
  },
];

export default function CompareRevylPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader />
      <main id="main-content" className="overflow-x-clip">
        <Hero />
        <DecisionSection />
        <ComparisonTable />
        <CostSection />
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
      <div className={`${container} relative pt-14 pb-16 sm:pt-20 lg:pt-24 lg:pb-20`}>
        <div className="max-w-3xl">
          <p className={`${eyebrow} text-ribbon-blue`}>Compare</p>
          <h1 className="mt-5 font-display text-hero font-semibold lg:text-hero-wide">
            The <span className="ribbon-text">open-source Revyl alternative</span> for local agent
            verification.
          </h1>
          <p className={`${lede} mt-7 max-w-2xl sm:text-lede-wide`}>
            Revyl provides metered cloud devices and build infrastructure. Relay gives coding agents
            eyes and hands on the web apps, phones, and simulators already on your machine. The
            right choice depends on whether you need cloud elasticity or local control.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a href="#choose" className={buttonVariants({ className: inkButton })}>
              Choose deliberately <ArrowRight className="size-4" />
            </a>
            <a
              href={repositoryUrl}
              className={buttonVariants({ variant: "outline", className: quietButton })}
            >
              <GitHubMark /> View Relay source
            </a>
          </div>
          <p className="mt-5 max-w-2xl text-step leading-relaxed text-muted-foreground">
            This comparison is factual, not a takedown. Revyl is a strong fit for hosted device
            infrastructure; Relay is for proof that never has to leave your machine.
          </p>
        </div>
      </div>
    </section>
  );
}

function DecisionSection() {
  return (
    <section id="choose" className={`${container} scroll-mt-24 pb-24 sm:pb-32`}>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChoiceCard
          eyebrow="Choose Revyl when"
          title="The cloud is the point."
          tone="blue"
          points={revylWins}
        />
        <ChoiceCard
          eyebrow="Choose Relay when"
          title="Local control is the point."
          tone="orange"
          points={relayWins}
        />
      </div>
    </section>
  );
}

function ChoiceCard({
  eyebrow: label,
  title,
  tone,
  points,
}: {
  eyebrow: string;
  title: string;
  tone: "blue" | "orange";
  points: string[];
}) {
  const color = tone === "blue" ? "text-ribbon-blue" : "text-ribbon-orange";
  const dot = tone === "blue" ? "bg-ribbon-blue" : "bg-ribbon-orange";
  return (
    <article className="rounded-2xl border bg-card p-7 shadow-sm sm:p-8">
      <p className={`${eyebrow} ${color}`}>{label}</p>
      <h2 className="mt-4 font-display text-feature font-semibold tracking-display">{title}</h2>
      <ul className="mt-7 space-y-4 text-quiet leading-relaxed">
        {points.map((point) => (
          <li key={point} className="flex gap-3">
            <span className={`mt-2 size-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function ComparisonTable() {
  return (
    <section className="border-t bg-card/60">
      <div className={`${container} py-24 sm:py-32`}>
        <div className="max-w-2xl">
          <p className={`${eyebrow} text-ribbon-violet`}>Side by side</p>
          <h2 className={`${h2} mt-4`}>Different constraints, different winners.</h2>
          <p className={`${lede} mt-5`}>
            Revyl provides managed runtime elasticity. Relay keeps verification inside your
            workspace. Neither bullet list makes the other product unnecessary.
          </p>
        </div>
        <div className="mt-12 overflow-x-auto rounded-2xl border bg-background shadow-sm">
          <table className="w-full min-w-176 border-collapse text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/60 font-mono text-eyebrow uppercase text-muted-foreground">
                <th scope="col" className="w-[16%] px-5 py-4 font-medium">
                  Area
                </th>
                <th scope="col" className="w-[42%] px-5 py-4 font-medium">
                  Relay
                </th>
                <th scope="col" className="w-[42%] px-5 py-4 font-medium">
                  Revyl
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.area} className="border-b align-top last:border-b-0">
                  <th scope="row" className="px-5 py-5 font-medium tracking-tight">
                    {row.area}
                  </th>
                  <td className="px-5 py-5 leading-relaxed text-muted-foreground">{row.relay}</td>
                  <td className="px-5 py-5 leading-relaxed text-muted-foreground">{row.revyl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-3xl text-step leading-relaxed text-muted-foreground">
          Revyl details reviewed November 27, 2026 from its public{" "}
          <ExternalLink href="https://revyl.com/pricing/">pricing</ExternalLink>,{" "}
          <ExternalLink href="https://revyl.com/platform/cloud-devices/">
            cloud devices
          </ExternalLink>
          , and{" "}
          <ExternalLink href="https://revyl.com/products/mobile-testing/">
            mobile testing
          </ExternalLink>{" "}
          pages. Packaging changes; confirm current terms before making a purchasing decision.
        </p>
      </div>
    </section>
  );
}

function CostSection() {
  return (
    <section className={`${container} py-24 sm:py-28`}>
      <div className="grid gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-[0.9fr_1.1fr]">
        <div className="bg-background p-7 sm:p-9">
          <p className={`${eyebrow} text-ribbon-pink`}>Cost</p>
          <h2 className="mt-4 font-display text-feature font-semibold tracking-display">
            Understand metered minutes before you scale.
          </h2>
          <p className="mt-4 text-quiet leading-relaxed text-muted-foreground">
            Revyl's free allowance is real and useful for evaluation. After that allowance, public
            pricing lists iOS and Android at $4.50 per device-hour, and web or macOS at $3.00 per
            device-hour. Parallel devices consume device time independently.
          </p>
        </div>
        <div className="bg-background p-7 sm:p-9">
          <div className="grid gap-4 sm:grid-cols-2">
            <CostExample hours="60" cost="$270" />
            <CostExample hours="160" cost="$720" />
          </div>
          <p className="mt-5 text-step leading-relaxed text-muted-foreground">
            Examples are billable iOS or Android device-hours after any free allowance, at the
            published $0.075 per minute. They are arithmetic, not quotes. Relay charges nothing per
            local replay; your hardware and any model-assisted steps are the costs.
          </p>
        </div>
      </div>
    </section>
  );
}

function CostExample({ hours, cost }: { hours: string; cost: string }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="font-mono text-eyebrow uppercase text-muted-foreground">
        {hours} mobile device-hours
      </p>
      <p className="mt-3 font-display text-3xl font-semibold tracking-display">{cost}</p>
      <p className="mt-2 text-step text-muted-foreground">at $4.50 per device-hour</p>
    </div>
  );
}

function FaqSection() {
  return (
    <section className="border-t bg-card/60">
      <div
        className={`${container} grid gap-10 py-24 sm:py-32 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]`}
      >
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className={`${eyebrow} text-ribbon-blue`}>Questions</p>
          <h2 className={`${h2} mt-4`}>The honest version.</h2>
          <p className={`${lede} mt-5 max-w-sm`}>
            The answer is not “always Relay.” It depends on where the device has to live.
          </p>
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
              <p className="max-w-[62ch] pb-6 text-quiet leading-relaxed text-muted-foreground">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingSection() {
  return (
    <section className={`${container} py-24 sm:py-32`}>
      <div className="grid gap-10 overflow-hidden rounded-banner border bg-card px-7 py-12 sm:px-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center">
        <div>
          <p className={`${eyebrow} text-ribbon-orange`}>Try the local path</p>
          <h2 className={`${h2} mt-4`}>Verify the next change on your own machine.</h2>
          <p className={`${lede} mt-5 max-w-lg`}>
            Start with the npx packages, connect your agent over MCP, and keep the Tests, Runs, and
            evidence in your workspace.
          </p>
          <Link
            href="/docs/agents/mcp"
            className="group mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
          >
            Read the MCP guide{" "}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
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
          </div>
        </div>
      </div>
    </section>
  );
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-4"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  );
}
