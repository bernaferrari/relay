import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  Code2,
  GitFork,
  Globe2,
  ImageIcon,
  LockKeyhole,
  MousePointer2,
  ScanLine,
  Smartphone,
  Terminal,
  ChevronDown,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@relay/ui-react/components/card";
import { WorkflowDiagram } from "@/components/workflow-diagram";
import { buttonVariants } from "@relay/ui-react/components/button";
import { SiteHeader } from "@/components/site-header";
import { RelayBrand } from "@/components/relay-brand";
import { ProductPreview } from "@/components/product-preview";
import { CopyExampleCommand } from "@/components/site-controls";
import { repositoryUrl } from "@/lib/site";

const workflow = [
  {
    number: "01",
    icon: MousePointer2,
    title: "Record a flow",
    description:
      "Click through your app to record a flow, or describe what should work. Edit the steps before you run them.",
    link: "/docs/workflows/recording",
    label: "Record your first flow",
  },
  {
    number: "02",
    icon: CircleCheck,
    title: "Run the test",
    description:
      "Replay saved steps on your website, phone, or tablet. Follow the screen path and inspect the result of each step.",
    link: "/docs/workflows/running",
    label: "Understand a run",
  },
  {
    number: "03",
    icon: ScanLine,
    title: "Review the evidence",
    description:
      "Review screenshots from the actual run. Mark what looks right, report an issue, and share the evidence behind your decision.",
    link: "/docs/workflows/review",
    label: "Explore screenshot review",
  },
];

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

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <section className={`${container} grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24`}>
          <div>
            <p className="mb-6 text-sm font-medium text-muted-foreground">
              Open-source testing workspace
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
              Test your app.
              <br />
              See the proof.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Record a flow, replay the steps, and review the result on web, Android, or iOS.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/docs/getting-started/first-test"
                className={buttonVariants({ className: "h-11 gap-2 px-5" })}
              >
                Get started <ArrowRight className="size-4" />
              </Link>
              <a href={repositoryUrl} className={textLink}>
                <GitFork className="size-4" /> View the source
              </a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <LockKeyhole className="size-4" /> Open source. Runs on your machine.
            </p>
          </div>
          <ProductPreview />
        </section>
        <div
          className={`${container} flex flex-wrap items-center gap-x-8 gap-y-4 border-y py-6 text-sm text-muted-foreground`}
        >
          <span className="mr-auto">Supported devices</span>
          <span className="inline-flex items-center gap-2">
            <Globe2 className="size-4" /> Web
          </span>
          <span className="inline-flex items-center gap-2">
            <Smartphone className="size-4" /> Android
          </span>
          <span className="inline-flex items-center gap-2">
            <Smartphone className="size-4" /> iPhone & iPad
          </span>
        </div>
        <section id="workflow" className={`${container} scroll-mt-24 py-20`}>
          <h2 className={heading}>Record. Run. Review.</h2>
          <p className="mt-4 text-muted-foreground">
            A test is more useful when everyone can see how it ran.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {workflow.map(({ number, icon: Icon, title, description, link, label }) => (
              <Card key={number}>
                <CardHeader>
                  <Icon className="mb-3 size-5 text-muted-foreground" />
                  <CardTitle>{title}</CardTitle>
                  <CardDescription className="leading-relaxed">{description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href={link} className={textLink}>
                    {label}
                    <ArrowUpRight className="size-4" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        <section className={`${container} grid items-center gap-8 pb-20 md:grid-cols-2`}>
          <div>
            <h2 className={heading}>Follow the path through your app.</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Relay's Map grows as runs visit screens. See how they connect, where a test failed,
              and which paths still need attention.
            </p>
            <Link href="/docs/workflows/map" className={`${textLink} mt-3`}>
              Explore the Map <ArrowRight className="size-4" />
            </Link>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>A complete testing loop</CardTitle>
              <CardDescription>Every run leaves evidence you can inspect.</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkflowDiagram />
            </CardContent>
          </Card>
        </section>
        <section className="border-y bg-muted/30">
          <div className={`${container} grid items-center gap-8 py-16 md:grid-cols-2`}>
            <div>
              <h2 className={heading}>Same tests. Same evidence.</h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                Work visually in Relay, or give your coding agent the CLI and MCP tools. Both use
                the same workspace and run results.
              </p>
              <div className="mt-3 flex gap-5">
                <Link href="/docs/agents/cli" className={textLink}>
                  CLI guide <ArrowUpRight className="size-4" />
                </Link>
                <Link href="/docs/agents/mcp" className={textLink}>
                  MCP setup <ArrowUpRight className="size-4" />
                </Link>
              </div>
            </div>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="size-4" /> Run from your terminal
                  </CardTitle>
                  <CopyExampleCommand
                    text={'./bin/relay run "Checkout total" --app Shop --device browser'}
                  />
                </div>
                <CardDescription>After saving a test in your workspace:</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs leading-6">
                  <code>{'./bin/relay run "Checkout total" --app Shop --device browser'}</code>
                </pre>
                <p className="mt-4 text-sm text-muted-foreground">
                  Add <code className="rounded bg-muted px-1 py-0.5">--json</code> for structured
                  output.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
        <section className={`${container} grid gap-8 py-20 md:grid-cols-3`}>
          {[
            {
              icon: LockKeyhole,
              title: "Your workspace stays yours.",
              description:
                "Tests and evidence live locally. Choose what gets captured and which model provider you use.",
            },
            {
              icon: ImageIcon,
              title: "Keep it lightweight.",
              description:
                "Screenshots, screen structure, and diagnostics by default. Add video when motion matters.",
            },
            {
              icon: Code2,
              title: "Work in the open.",
              description:
                "Read the source, edit the steps, inspect the results. Relay is built to be understandable.",
            },
          ].map(({ icon: Icon, title, description }) => (
            <article key={title}>
              <Icon className="mb-4 size-5 text-muted-foreground" />
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </article>
          ))}
        </section>
        <section className={`${container} grid gap-8 border-t py-16 md:grid-cols-2`}>
          <div>
            <h2 className={heading}>Before you start.</h2>
            <Link href="/docs" className={`${textLink} mt-4`}>
              More in the docs <ArrowRight className="size-4" />
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
          <Card>
            <CardContent className="flex flex-col items-start justify-between gap-6 pt-6 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Start with one flow.</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try the local demo. Catch a bug, inspect the repair, and rerun the same test.
                </p>
              </div>
              <div className="shrink-0">
                <Link
                  href="/docs/getting-started/first-test"
                  className={buttonVariants({ className: "h-11 gap-2 px-5" })}
                >
                  Run your first test <ArrowRight className="size-4" />
                </Link>
                <p className="mt-3 text-xs text-muted-foreground">
                  No account or model key needed for the demo.
                </p>
              </div>
            </CardContent>
          </Card>
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
              className="inline-flex min-h-11 items-center hover:text-foreground"
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
