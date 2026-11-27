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
  title: { absolute: "Maestro alternative: Relay vs Maestro" },
  description:
    "An honest comparison of Maestro's deterministic YAML mobile automation and Relay, the open-source verification workspace for coding agents on web, Android, and iOS.",
  alternates: { canonical: "/compare/maestro" },
  openGraph: {
    title: "Maestro alternative: Relay vs Maestro",
    description:
      "Where Maestro's mature, model-free mobile automation wins, and where Relay's agent-native verification loop wins.",
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
    title: "Maestro alternative: Relay vs Maestro",
    description:
      "Where Maestro's mature, model-free mobile automation wins, and where Relay's agent-native verification loop wins.",
    images: ["/og.png"],
  },
};

const maestroWins = [
  "You want proven mobile UI automation. Maestro is mature, widely adopted, and validated at scale by enterprise teams.",
  "Every execution must be deterministic with zero model involvement — no model key to manage, ever, on any path.",
  "You want flakiness handled for you: built-in tolerance and zero-wait intelligence absorb UI settling, animations, and network timing.",
  "Your flows need logic: nested subflows, loops, conditions, lifecycle hooks, parameters, and embedded JavaScript.",
  "You prefer authoring visually in Maestro Studio, or scaling out on hosted devices with Maestro Cloud.",
  "You want the simplest mobile-only setup: one CLI binary that runs flows directly, with no workspace service to keep running.",
];

const relayWins = [
  "You need physical iPhones or iPads. Maestro supports iOS simulators only; Relay also drives trusted physical iOS devices.",
  "Tests should describe what must work, not which elements to tap — plain-English steps a coding agent can write and maintain.",
  "The verification loop belongs to the agent: run the test, read an expected-vs-saw verdict, inspect the failure, repair, rerun — over MCP.",
  "Evidence needs a review workflow: step screenshots, content-addressed trace packs, and human accept-or-flag decisions that stay with each Run.",
  "Web is a first-class target next to Android and iOS in one workspace, with saved accounts, data sets, Plans, and scheduling.",
  "You want Node.js and nothing else. Maestro 2.x requires a Java 17+ runtime; Relay does not.",
];

const comparisonRows: { area: string; relay: string; maestro: string }[] = [
  {
    area: "Core model",
    relay:
      "Local verification workspace for coding agents and developers: Tests, Runs, evidence, and review.",
    maestro:
      "UI automation framework: declarative YAML flows executed directly against devices and browsers.",
  },
  {
    area: "Test definition",
    relay:
      "Plain-English actions and checks. Recorded interactions replay exactly; described steps are resolved semantically.",
    maestro:
      "Explicit commands such as tapOn, inputText, and assertVisible, aimed at visible text or accessibility IDs.",
  },
  {
    area: "Model involvement",
    relay:
      "None for recorded or otherwise bound replay. Newly written plain-English steps need recording, binding, or a model-assisted path.",
    maestro: "None, ever. Every flow executes deterministically with no model on any path.",
  },
  {
    area: "Platforms",
    relay:
      "Chrome-family browsers, Android devices and emulators, and iOS simulators plus physical iPhones and iPads.",
    maestro:
      "Android devices and emulators, iOS simulators, and web browsers. Physical iOS devices are not supported; web support is functional with ongoing development.",
  },
  {
    area: "Flakiness handling",
    relay:
      "Explicit waits and checks on conditions you define. Recorded steps replay their saved interactions.",
    maestro:
      "Built-in tolerance and zero-wait intelligence automatically handle UI settling, loading content, and animations.",
  },
  {
    area: "Flow logic",
    relay:
      "Deliberately flat action-and-check lists. The YAML format rejects retry, timeout, fixture, and loop fields.",
    maestro:
      "Nested subflows, loops, conditions, hooks, parameters, and embedded JavaScript in the YAML format itself.",
  },
  {
    area: "Agent integration",
    relay:
      "MCP-native verification loop: run Tests, read expected-vs-saw verdicts, inspect failures, record, and export evidence through typed tools.",
    maestro:
      "An MCP server ships inside the Maestro CLI. Agents use it to write, run, and debug YAML flows on a live device.",
  },
  {
    area: "Evidence and review",
    relay:
      "Expected-vs-saw verdicts, before-and-after step screenshots, content-addressed trace packs, and a human screenshot review queue.",
    maestro:
      "Flow output, screenshots, and reports. No human review workflow is attached to the results.",
  },
  {
    area: "Runtime requirements",
    relay:
      "Node.js 24+, plus platform tools for your targets: a supported browser, adb, or macOS with Xcode. A local workspace service stays running.",
    maestro:
      "A single CLI binary that requires Java 17+. iOS simulators still need Xcode. No long-running workspace service.",
  },
  {
    area: "Scale-out",
    relay: "Bounded by your own machines, devices, and emulators. There is no Relay cloud.",
    maestro: "Local devices, plus Maestro Cloud for hosted parallel execution in CI.",
  },
  {
    area: "Maturity",
    relay: "In active development; device support varies by platform. MIT licensed.",
    maestro: "Established since 2022 with a large community and ecosystem. Apache-2.0 licensed.",
  },
];

const maestroFlow = `appId: com.example.shop
---
- launchApp
- tapOn: "Sign in"
- inputText: "sam@example.com"
- tapOn: "Continue"
- assertVisible: "Welcome back"`;

const relayTest = `name: Sign in shows the welcome screen
url: https://shop.example.com
steps:
  - Open the sign-in page
  - Sign in as sam@example.com
  - check: The welcome message is visible
  - check: There is no error message`;

const faqs = [
  {
    question: "Is Relay a drop-in Maestro replacement?",
    answer:
      "No. If your requirement is mature, deterministic mobile flow automation with zero model involvement everywhere, Maestro is the better fit today. If your requirement is a verification loop a coding agent can drive — across web, Android, and iOS, with evidence a human can review — Relay is the better fit.",
  },
  {
    question: "Does Relay need a model when Maestro never does?",
    answer:
      "Sometimes, yes. Relay's recorded or otherwise bound interactions replay deterministically at $0 model cost, but newly written plain-English steps need recording, binding, or a model-assisted execution path. Maestro has no semantic layer at all, so no execution path ever involves a model. That is a real Maestro advantage.",
  },
  {
    question: "Both tools have MCP servers. What is the difference?",
    answer:
      "Maestro's MCP server gives a coding agent device control so it can write, run, and debug YAML flows. Relay's MCP server exposes the verification loop itself: run a saved Test, read an expected-vs-saw verdict, inspect the failing step's evidence, export a trace pack, and record new coverage — while human screenshot review stays attached to each Run.",
  },
  {
    question: "Can Relay test a physical iPhone?",
    answer:
      "Yes, with macOS and Xcode: Relay supports trusted physical iPhones and iPads as well as simulators. Maestro currently supports iOS simulators only — its documentation states that physical iOS devices are not yet supported. For Android, both tools drive physical devices and emulators.",
  },
  {
    question: "Which one is easier to start with?",
    answer:
      "For a mobile-only team writing flows by hand, Maestro is simpler: install the CLI, write a YAML flow, run it — no workspace service. Relay starts with npx and keeps a local workspace running because Tests, Runs, and evidence live there. The trade is deliberate: the workspace is what makes evidence review and cross-platform reruns possible.",
  },
];

export default function CompareMaestroPage() {
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
        <AuthoringSection />
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
            The <span className="ribbon-text">agent-native Maestro alternative</span> for verified
            mobile and web.
          </h1>
          <p className={`${lede} mt-7 max-w-2xl sm:text-lede-wide`}>
            Maestro is the mature open-source answer to deterministic mobile UI automation. Relay is
            a verification workspace built for coding agents: plain-English Tests, deterministic
            replay of recorded interactions, and reviewable evidence across web, Android, and iOS.
            They overlap less than the YAML suggests.
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
            This comparison is factual, not a takedown. Maestro is the stronger choice for most
            mobile-only flow automation today; Relay is for agent-driven verification with proof.
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
          eyebrow="Choose Maestro when"
          title="Deterministic flows are the point."
          tone="blue"
          points={maestroWins}
        />
        <ChoiceCard
          eyebrow="Choose Relay when"
          title="The verification loop is the point."
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
          <h2 className={`${h2} mt-4`}>Adjacent tools, different centers of gravity.</h2>
          <p className={`${lede} mt-5`}>
            Both are open source, both use YAML, both drive real devices. Maestro centers the flow;
            Relay centers the verdict, the evidence, and the agent acting on them.
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
                  Maestro
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
                  <td className="px-5 py-5 leading-relaxed text-muted-foreground">{row.maestro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-3xl text-step leading-relaxed text-muted-foreground">
          Maestro details reviewed November 27, 2026 from its public{" "}
          <ExternalLink href="https://docs.maestro.dev/get-started/what-is-maestro">
            overview
          </ExternalLink>
          ,{" "}
          <ExternalLink href="https://docs.maestro.dev/get-started/supported-platform">
            supported platforms
          </ExternalLink>
          ,{" "}
          <ExternalLink href="https://docs.maestro.dev/get-started/maestro-mcp">
            MCP server
          </ExternalLink>
          , and{" "}
          <ExternalLink href="https://github.com/mobile-dev-inc/maestro/">
            GitHub repository
          </ExternalLink>{" "}
          pages. Capabilities change; confirm current terms before making a tooling decision.
        </p>
      </div>
    </section>
  );
}

function AuthoringSection() {
  return (
    <section className={`${container} py-24 sm:py-28`}>
      <div className="grid gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-[0.9fr_1.1fr]">
        <div className="bg-background p-7 sm:p-9">
          <p className={`${eyebrow} text-ribbon-pink`}>Authoring model</p>
          <h2 className="mt-4 font-display text-feature font-semibold tracking-display">
            Explicit commands or described outcomes.
          </h2>
          <p className="mt-4 text-quiet leading-relaxed text-muted-foreground">
            A Maestro flow names the interface elements to drive, and Maestro resolves those exact
            commands deterministically at runtime. A Relay Test describes what should work; a model
            can resolve descriptions that have not been recorded, and recorded interactions replay
            without one.
          </p>
          <p className="mt-4 text-quiet leading-relaxed text-muted-foreground">
            Neither is strictly better. Explicit commands never surprise you. Described outcomes let
            a coding agent author and repair tests without memorizing your interface — at the cost
            of a model on unrecorded paths.
          </p>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2">
          <figure className="bg-background p-5 sm:p-6">
            <figcaption className="font-mono text-eyebrow uppercase text-muted-foreground">
              Maestro flow
            </figcaption>
            <pre className="mt-3 overflow-x-auto font-mono text-step leading-6 text-foreground/90">
              {maestroFlow}
            </pre>
          </figure>
          <figure className="bg-background p-5 sm:p-6">
            <figcaption className="font-mono text-eyebrow uppercase text-muted-foreground">
              Relay test
            </figcaption>
            <pre className="mt-3 overflow-x-auto font-mono text-step leading-6 text-foreground/90">
              {relayTest}
            </pre>
          </figure>
        </div>
      </div>
    </section>
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
            The answer is not “always Relay.” It depends on who maintains the test and what the
            verdict is worth.
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
