import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  Globe2,
  ImageIcon,
  LockKeyhole,
  MousePointer2,
  Play,
  ScanLine,
  Smartphone,
  Tablet,
  Terminal,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@relay/ui-react/components/card";
import { buttonVariants } from "@relay/ui-react/components/button";
import { SiteHeader } from "@/components/site-header";
import { RelayBrand } from "@/components/relay-brand";
import { ProductShowcase } from "@/components/product-showcase";
import { CopyExampleCommand } from "@/components/site-controls";
import { repositoryUrl } from "@/lib/site";

const faqs = [
  {
    question: "Do I need a model key?",
    answer: (
      <>
        The local first-test demo and deterministic recorded steps work without one. Describing a
        test or using model-assisted actions requires a model key.{" "}
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
        Tests, runs, and captured evidence are retained in your local workspace. Model-assisted
        actions can send the input they need to your configured model provider. You control optional
        evidence collection in <Link href="/docs/reference/evidence">Evidence & privacy</Link>.
      </>
    ),
  },
  {
    question: "Can I use my existing e2e tests?",
    answer: (
      <>
        Relay has an opt-in reporter and process integration for upstream e2e. It runs the original
        program and preserves its result. This is an integration prototype; the visual
        project-picker experience is still in development.{" "}
        <Link href="/docs/agents/e2e">See the supported scope.</Link>
      </>
    ),
  },
  {
    question: "Is Relay free and open source?",
    answer: (
      <>
        Relay's source is available under the MIT license. You can run it from the repository today.
        Model providers may charge for model-assisted actions.{" "}
        <Link href="/docs/getting-started/first-test">Start with the demo</Link> without a model
        key.
      </>
    ),
  },
];

const container = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const heading = "text-3xl font-semibold tracking-tight sm:text-4xl";
const textLink =
  "inline-flex min-h-11 items-center gap-2 text-sm font-medium underline-offset-4 hover:underline";
const workflow = [
  {
    number: "01",
    icon: MousePointer2,
    title: "Record what you actually do.",
    description:
      "Click through your website or mobile app. Keep the useful steps, add checks, and save the flow.",
    link: "/docs/workflows/recording",
    label: "Recording guide",
  },
  {
    number: "02",
    icon: Play,
    title: "Run it. See what happened.",
    description:
      "Replay on your own device. Follow each action and the screens it reaches, with evidence for the result.",
    link: "/docs/workflows/running",
    label: "Running tests",
  },
  {
    number: "03",
    icon: ScanLine,
    title: "Make the call with evidence.",
    description:
      "Inspect the screenshots from that run. Accept what looks right, flag an issue, and keep the review decision.",
    link: "/docs/workflows/review",
    label: "Screenshot review",
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <section className={`${container} pt-10 pb-6 sm:pt-20 sm:pb-12`}>
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-6 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Local QA. For people and agents.
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-6xl">
              Record a flow.
              <br />
              <span className="text-primary">Make it repeatable.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Test websites and mobile apps in one workspace. Follow every run, inspect the
              screenshots, and keep the evidence behind your decision.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/docs/getting-started/first-test"
                className={buttonVariants({ className: "h-11 px-5" })}
              >
                Try the demo <ArrowRight className="size-4" />
              </Link>
              <a
                href="#workspace"
                aria-label="Explore the workspace"
                className={buttonVariants({ variant: "outline", className: "h-11 px-5" })}
              >
                See Relay
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Local demo. No model key required.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
              <Link
                href="/docs/devices/browser"
                className="inline-flex min-h-11 items-center gap-2 hover:text-foreground"
              >
                <Globe2 className="size-4" /> Web
              </Link>
              <Link
                href="/docs/devices/android"
                className="inline-flex min-h-11 items-center gap-2 hover:text-foreground"
              >
                <Smartphone className="size-4" /> Android
              </Link>
              <Link
                href="/docs/devices/ios"
                className="inline-flex min-h-11 items-center gap-2 hover:text-foreground"
              >
                <Tablet className="size-4" /> iOS
              </Link>
            </div>
          </div>
        </section>
        <section className={`${container} pb-16 sm:pb-20`} aria-label="Explore Relay's workspace">
          <ProductShowcase />
        </section>
        <section id="workflow" className="scroll-mt-8 border-y bg-card">
          <div className={`${container} py-14 sm:py-20`}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  The useful part is the whole loop
                </p>
                <h2 className={heading}>Record. Run. Review.</h2>
              </div>
              <Link href="/docs" className={textLink}>
                Read the field guide <ArrowUpRight className="size-4" />
              </Link>
            </div>
            <div className="mt-10 grid gap-10 md:grid-cols-3">
              {workflow.map(({ number, icon: Icon, title, description, link, label }) => (
                <article key={number}>
                  <div className="mb-5 flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground">{number}</span>
                    <span className="h-px w-8 bg-border" />
                    <Icon className="size-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                  <Link href={link} className={`${textLink} mt-3`}>
                    {label}
                    <ArrowRight className="size-4" />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className={`${container} grid items-center gap-10 py-16 sm:py-20 md:grid-cols-2`}>
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Start with something that really runs
            </p>
            <h2 className={heading}>
              Catch a bug.
              <br />
              Prove the repair.
            </h2>
            <p className="mt-5 max-w-lg leading-relaxed text-muted-foreground">
              The local demo checks a layout, catches an overlapping button, repairs the demo
              website, and runs the same saved test again. You can inspect both results.
            </p>
            <Link href="/docs/getting-started/first-test" className={`${textLink} mt-4`}>
              Follow the quickstart <ArrowRight className="size-4" />
            </Link>
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="size-4" /> Your first run
                </CardTitle>
                <CopyExampleCommand text={"pnpm ensure:serve\npnpm demo"} />
              </div>
              <CardDescription>From a source checkout, after pnpm install:</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm leading-7">
                <code>{"pnpm ensure:serve\npnpm demo"}</code>
              </pre>
              <ul className="mt-5 grid gap-3 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-primary" /> See the failing check
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-primary" /> Inspect the repair
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-primary" /> Repeat the saved test
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>
        <section className="border-y bg-muted/30">
          <div className={`${container} grid gap-10 py-14 sm:py-16 md:grid-cols-3`}>
            {[
              {
                icon: LockKeyhole,
                title: "Your devices. Your workspace.",
                description:
                  "Use your local browser, Android phone, or iOS device. Tests and evidence stay in the workspace you own.",
              },
              {
                icon: ImageIcon,
                title: "Keep the evidence lightweight.",
                description:
                  "Collect screenshots, screen structure, and diagnostics. Add video when you need to inspect motion.",
              },
              {
                icon: Code2,
                title: "Bring your coding agent.",
                description:
                  "The UI, CLI, and MCP tools use the same saved tests and run results. Pick the interface that suits the job.",
              },
            ].map(({ icon: Icon, title, description }) => (
              <article key={title}>
                <Icon className="mb-4 size-5 text-primary" />
                <h3 className="text-base font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </section>
        <section className={`${container} grid gap-8 py-16 sm:py-20 md:grid-cols-2`}>
          <div>
            <h2 className={heading}>Before your first run.</h2>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Source setup, real devices, model keys, and the current scope of e2e support.
            </p>
            <Link href="/docs/getting-started/installation" className={`${textLink} mt-3`}>
              Installation guide <ArrowRight className="size-4" />
            </Link>
          </div>
          <div>
            {faqs.map(({ question, answer }) => (
              <details key={question} className="group border-b">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  {question}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
                </summary>
                <p className="pb-5 text-sm leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </section>
        <section className={`${container} pb-16`}>
          <div className="flex flex-col items-start justify-between gap-6 border-t pt-10 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Give one flow a repeat button.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Start with the demo, then record a journey in your own app.
              </p>
            </div>
            <Link
              href="/docs/getting-started/first-test"
              className={buttonVariants({ className: "h-11 px-5" })}
            >
              Get started <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>
      <footer className="border-t">
        <div className={`${container} flex flex-wrap items-center justify-between gap-6 py-8`}>
          <Link href="/" aria-label="Relay home">
            <RelayBrand />
          </Link>
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-5 text-sm text-muted-foreground"
          >
            <Link href="/docs" className="inline-flex min-h-11 items-center hover:text-foreground">
              Documentation
            </Link>
            <a
              href={repositoryUrl}
              className="inline-flex min-h-11 items-center gap-2 hover:text-foreground"
            >
              GitHub
            </a>
            <a
              href={`${repositoryUrl}/issues`}
              className="inline-flex min-h-11 items-center hover:text-foreground"
            >
              Feedback
            </a>
            <a
              href={`${repositoryUrl}/blob/main/LICENSE`}
              className="inline-flex min-h-11 items-center hover:text-foreground"
            >
              MIT license
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}
