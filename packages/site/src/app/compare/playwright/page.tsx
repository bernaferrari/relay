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
  title: { absolute: "Playwright alternative: Relay vs Playwright" },
  description:
    "An honest comparison of Playwright's code-first browser testing and Relay, the open-source verification workspace coding agents drive across web, Android, and iOS.",
  alternates: { canonical: "/compare/playwright" },
  openGraph: {
    title: "Playwright alternative: Relay vs Playwright",
    description:
      "Where Playwright's engineering-owned browser testing wins, and where Relay's agent-native verification loop fits next to it.",
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
    title: "Playwright alternative: Relay vs Playwright",
    description:
      "Where Playwright's engineering-owned browser testing wins, and where Relay's agent-native verification loop fits next to it.",
    images: ["/og.png"],
  },
};

const playwrightWins = [
  "Your test suite is engineering-owned code: fixtures, hooks, retries, and first-class bindings for TypeScript, Python, Java, and .NET.",
  "You need the cross-browser matrix — Chromium, Firefox, and WebKit — with parallelism and sharding across CI machines.",
  "You need network interception and mocking, API testing, component testing, or deep tracing with DOM snapshots, network, and console in the Trace Viewer.",
  "Every execution must be deterministic with zero model involvement. Playwright never calls a model, on any path.",
  "You want the mature ecosystem: documentation, integrations, community answers, and a stable API backed by Microsoft.",
];

const relayWins = [
  "Tests should be plain-English YAML that coding agents write and maintain — described steps resolve against the current interface instead of a locator written in code.",
  "You need native iOS and Android apps in the same workspace as the web. Playwright automates browsers and webviews, not native apps.",
  "The verify loop belongs to the agent: run the test, read an expected-vs-saw verdict, inspect the failure, repair, rerun — over MCP, with evidence attached.",
  "Evidence review is part of the workflow: step screenshots, content-addressed trace packs, and human accept-or-flag decisions that stay with each Run.",
  "You want verification without writing test code at all: record a flow once and replay it deterministically, or describe it and let the agent draft it.",
];

const comparisonRows: { area: string; relay: string; playwright: string }[] = [
  {
    area: "Core model",
    relay:
      "Local verification workspace for coding agents and developers: Tests, Runs, evidence, and review.",
    playwright:
      "Code-first test framework and browser automation library with a full-featured test runner.",
  },
  {
    area: "Test authoring",
    relay:
      "Plain-English YAML checked into Git, or recording real interactions. No selectors to write or maintain.",
    playwright:
      "TypeScript, Python, Java, or .NET test code using resilient locators such as getByRole and getByLabel.",
  },
  {
    area: "Browser coverage",
    relay: "A locally installed Chrome, Chromium, or Edge, one target at a time.",
    playwright:
      "Chromium, Firefox, and WebKit — plus branded Chrome and Edge — across parallel workers and sharded CI machines.",
  },
  {
    area: "Mobile",
    relay:
      "Real Android devices and emulators, iOS simulators, and physical iPhones and iPads, driven as native apps.",
    playwright:
      "Mobile viewport emulation and experimental Chrome automation on Android devices. Native iOS and Android apps are not supported.",
  },
  {
    area: "Execution model",
    relay:
      "Tests run one after another on the targets you have. Parallelism is bounded by your machines.",
    playwright:
      "Parallel by default with test isolation, retries, fixtures, and sharding across machines. Built for large suites in CI.",
  },
  {
    area: "Waiting and flakiness",
    relay:
      "Explicit waits and checks on conditions you define; recorded steps replay their saved interactions.",
    playwright:
      "Auto-waiting and web-first assertions that retry until conditions are met, built into every action.",
  },
  {
    area: "Model involvement",
    relay:
      "None for recorded or otherwise bound replay. Newly written plain-English steps need recording, binding, or a model-assisted path.",
    playwright: "None, ever. Test code is deterministic on every execution path.",
  },
  {
    area: "Failure evidence",
    relay:
      "Expected-vs-saw verdicts, before-and-after step screenshots, screen structure, and content-addressed trace packs, plus human screenshot review.",
    playwright:
      "The Trace Viewer: DOM snapshots, network requests, console messages, screenshots, and video for every action.",
  },
  {
    area: "Agent integration",
    relay:
      "MCP-native verification loop: agents run Tests, read verdicts, inspect failures, record coverage, and export evidence as typed tools.",
    playwright:
      "The Playwright MCP server gives agents live browser control through accessibility snapshots. Tests themselves remain code a person or agent writes.",
  },
  {
    area: "Beyond the UI",
    relay: "Not a focus. Relay verifies what a person would see and do.",
    playwright:
      "Network interception and mocking, API request testing, and component testing with the built-in mount fixture.",
  },
  {
    area: "Maturity",
    relay: "In active development; device support varies by platform. MIT licensed.",
    playwright:
      "The incumbent since 2020, maintained by Microsoft, with over one hundred thousand GitHub stars. Apache-2.0 licensed.",
  },
];

const playwrightTest = `import { test, expect } from '@playwright/test';

test('sign in shows the welcome screen', async ({ page }) => {
  await page.goto('https://shop.example.com');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Welcome back')).toBeVisible();
});`;

const relayTest = `name: Sign in shows the welcome screen
url: https://shop.example.com
steps:
  - Open the sign-in page
  - Sign in as sam@example.com
  - check: The welcome message is visible
  - check: There is no error message`;

const faqs = [
  {
    question: "Is Relay a drop-in Playwright replacement?",
    answer:
      "No, and it does not try to be. Playwright is the right answer for engineering-owned browser test suites: cross-browser matrices, parallelism, fixtures, mocking, and tracing. Relay is the answer when a coding agent needs to verify its own work — on the web and on native mobile — and a person needs reviewable evidence of what happened.",
  },
  {
    question: "Can Relay and Playwright coexist in one project?",
    answer:
      "Yes, and that is the intended shape for many teams. Keep Playwright for the browser suite your engineers own. Use Relay for the agent verification loop and for native mobile coverage Playwright cannot reach. Relay's browser control is itself built on playwright-core, and its saved accounts accept Playwright storage-state JSON.",
  },
  {
    question: "Does Relay need a model when Playwright never does?",
    answer:
      "Sometimes, yes. Relay's recorded or otherwise bound interactions replay deterministically at $0 model cost, but newly written plain-English steps need recording, binding, or a model-assisted execution path. Playwright test code is deterministic on every run. That is a real Playwright advantage.",
  },
  {
    question: "What happens to Relay tests when the UI changes?",
    answer:
      "It depends on the step. Described steps re-resolve against the current interface at execution time, so wording-level changes often survive. Recorded steps replay exact interactions and can break when the layout or control identity changes — the same maintenance reality as locators, with the difference that a coding agent can re-record or repair the step as part of its loop.",
  },
  {
    question: "Should a test engineering team standardize on Relay?",
    answer:
      "Not today. Relay is in active development, runs one target at a time on your own hardware, covers only Chromium-family browsers on the web, and has no network mocking, API testing, or component testing. Teams with an established Playwright suite should add Relay where agents and native mobile need it, not migrate to it.",
  },
];

export default function ComparePlaywrightPage() {
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
        <ComplementSection />
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
            The <span className="ribbon-text">agent-era complement to Playwright</span>, not a
            replacement.
          </h1>
          <p className={`${lede} mt-7 max-w-2xl sm:text-lede-wide`}>
            Playwright is the best engineering-owned browser test framework, and Relay is built on
            its browser automation. Relay answers a different question: how a coding agent verifies
            its own work across web, Android, and iOS, with evidence a person can review. If you run
            an engineering-heavy test organization, keep Playwright.
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
            This comparison is factual, not a takedown. Playwright wins most head-to-head rows for
            browser testing; Relay exists for the rows Playwright was never aimed at.
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
          eyebrow="Choose Playwright when"
          title="The suite is engineering-owned code."
          tone="blue"
          points={playwrightWins}
        />
        <ChoiceCard
          eyebrow="Choose Relay when"
          title="The loop is agent-driven verification."
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
          <h2 className={`${h2} mt-4`}>Different tools answering different questions.</h2>
          <p className={`${lede} mt-5`}>
            Playwright asks what your engineers can prove in code. Relay asks what your agent can
            prove about the product itself — including the native apps Playwright cannot reach.
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
                  Playwright
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
                  <td className="px-5 py-5 leading-relaxed text-muted-foreground">
                    {row.playwright}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-3xl text-step leading-relaxed text-muted-foreground">
          Playwright details reviewed November 27, 2026 from its public{" "}
          <ExternalLink href="https://playwright.dev/">documentation</ExternalLink>,{" "}
          <ExternalLink href="https://playwright.dev/docs/release-notes">
            release notes
          </ExternalLink>
          , and{" "}
          <ExternalLink href="https://github.com/microsoft/playwright/">
            GitHub repository
          </ExternalLink>{" "}
          pages. Capabilities change; confirm current terms before making a tooling decision.
        </p>
      </div>
    </section>
  );
}

function ComplementSection() {
  return (
    <section className={`${container} py-24 sm:py-28`}>
      <div className="grid gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-[0.9fr_1.1fr]">
        <div className="bg-background p-7 sm:p-9">
          <p className={`${eyebrow} text-ribbon-pink`}>Coexistence</p>
          <h2 className="mt-4 font-display text-feature font-semibold tracking-display">
            Built on Playwright, not against it.
          </h2>
          <p className="mt-4 text-quiet leading-relaxed text-muted-foreground">
            Relay's browser control is built on playwright-core, and its saved accounts accept
            Playwright storage-state JSON for signed-in sessions. The tools share DNA; they do not
            share a job. Keep Playwright for the cross-browser suite your engineers own, and use
            Relay where the agent verifies its own changes or the product leaves the browser.
          </p>
          <p className="mt-4 text-quiet leading-relaxed text-muted-foreground">
            The authoring contrast is real. Playwright tests are code a person or agent writes and
            maintains. Relay Tests are descriptions of what should work — small enough for an agent
            to write in a loop and a person to review in a diff.
          </p>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2">
          <figure className="bg-background p-5 sm:p-6">
            <figcaption className="font-mono text-eyebrow uppercase text-muted-foreground">
              Playwright test
            </figcaption>
            <pre className="mt-3 overflow-x-auto font-mono text-step leading-6 text-foreground/90">
              {playwrightTest}
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
            The answer is not “always Relay.” For established browser suites, it usually is not
            Relay at all.
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
