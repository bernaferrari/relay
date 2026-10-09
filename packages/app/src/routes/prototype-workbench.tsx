/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { Circle, MousePointerClick, SlidersHorizontal, Video } from "lucide-react";
import { AuthoringWorkspace } from "./authoring-workspace";
import { WorkbenchPage, PageHeader } from "../components/page-layout";

/**
 * Slice 1 review artifact: the frozen workbench geometry from
 * docs/release/PRODUCT-DIRECTION.md, rendered from existing components with
 * annotations. Static by design — it validates layout decisions before any
 * production route is reorganized. Not a primary destination.
 */

const annotation =
  "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background";

const steps = [
  {
    kind: "Click",
    detail: "[Continue]",
    note: "Bracketed values open the matching picker; the underlying binding stays inspectable.",
  },
  {
    kind: "Fill",
    detail: "[Email] from [Member account]",
    note: "Field values resolve from named task values or an account fixture — never free-typed by a model.",
  },
  {
    kind: "Wait",
    detail: "until [Language options] are visible",
    note: "Action-specific readiness; a static valid load is not a failure.",
  },
  {
    kind: "Capture",
    detail: "[Arabic settings]",
    note: "Expected evidence checkpoint with its human review criterion attached.",
  },
];

const operatingStates = [
  ["Live · Not recording", "Input reaches the app but does not append test steps."],
  ["Recording", "Confirmed actions append to the draft in this step list."],
  ["Automation running", "Relay controls the target; manual takeover is explicit."],
  [
    "Paused · You have control",
    "Human interventions are retained and may need fresh verification.",
  ],
  ["Viewing saved evidence", "No live input can be dispatched from a historical image."],
] as const;

export function PrototypeWorkbenchPage() {
  return (
    <WorkbenchPage>
      <PageHeader
        crumbs={[{ label: "Prototype" }]}
        title="One workbench — annotated geometry"
        description="The frozen arrangement from the product direction: the tested application stays center-stage while modes, steps, and configuration change state around it. Static artifact for review — no live target is connected."
      />

      <div className="grid gap-3 px-[clamp(20px,3vw,40px)] pb-6">
        {/* Header row: document, persistence, configuration, primary actions. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border/70 bg-background/40 p-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={annotation} aria-hidden="true">
              1
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                Acme Store / Account settings
              </p>
              <p className="text-xs text-muted-foreground">
                Saved · Changed since last verified run
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className={annotation} aria-hidden="true">
              2
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-label="Configuration summary — opens the shared composer"
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Staging · Chrome · Member · English
            </Button>
            <span className={annotation} aria-hidden="true">
              3
            </span>
            <Button variant="outline" size="sm">
              <Video className="size-4" aria-hidden="true" />
              Record
            </Button>
            <Button size="sm">Run</Button>
          </div>
        </div>

        <AuthoringWorkspace
          stage={
            <div
              className="grid h-full place-content-center gap-4 rounded-lg border border-dashed border-border bg-background/30 p-6 text-center"
              aria-label="Application stage placeholder"
            >
              <span className={annotation} aria-hidden="true">
                4
              </span>
              <div>
                <p className="text-base font-medium text-foreground">Your application</p>
                <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-muted-foreground">
                  Live pixels or explicitly labeled historical evidence. The stage keeps its
                  position across recording, editing, running, and investigating.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Badge variant="outline">
                  <Circle className="size-3 fill-current" aria-hidden="true" />
                  Live · Not recording
                </Badge>
                <Badge variant="secondary">Controller: you</Badge>
              </div>
            </div>
          }
          tools={
            <div className="grid gap-3 p-3">
              <div className="flex items-center gap-2">
                <span className={annotation} aria-hidden="true">
                  5
                </span>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Steps
                </p>
              </div>
              <ol className="grid list-none gap-2 p-0">
                {steps.map((step, index) => (
                  <li
                    key={step.kind}
                    className="rounded-lg border border-border/60 bg-background/50 p-3"
                  >
                    <p className="text-sm leading-5 text-foreground">
                      <span className="mr-2 text-xs text-muted-foreground">{index + 1}</span>
                      {step.kind} <strong className="font-medium">{step.detail}</strong>
                    </p>
                    <p className="mt-1 text-xs leading-4 text-muted-foreground">{step.note}</p>
                  </li>
                ))}
              </ol>
              <p className="rounded-lg bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                Selecting a bracketed value opens its picker. Selecting a step shows its evidence
                and contextual editing — raw labels, coordinates, and connection IDs remain an
                escape hatch, not the interface.
              </p>
            </div>
          }
          inspector={
            <div className="grid gap-3 p-3">
              <div className="flex items-center gap-2">
                <span className={annotation} aria-hidden="true">
                  6
                </span>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Operating states
                </p>
              </div>
              <dl className="grid gap-2">
                {operatingStates.map(([state, meaning]) => (
                  <div
                    key={state}
                    className="rounded-lg border border-border/60 bg-background/50 p-3"
                  >
                    <dt className="text-sm font-medium text-foreground">{state}</dt>
                    <dd className="mt-0.5 text-xs leading-4 text-muted-foreground">{meaning}</dd>
                  </div>
                ))}
              </dl>
              <p className="rounded-lg bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                Current pixels and historical evidence are never blurred: a screenshot selection
                cannot act on a different live session.
              </p>
            </div>
          }
        />

        {/* Bottom diagnostics stay synchronized with the stage selection. */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-background/40 p-3"
          aria-label="Diagnostics row"
        >
          <MousePointerClick className="size-4 text-muted-foreground" aria-hidden="true" />
          {["Logs", "Network", "Details"].map((label) => (
            <Badge key={label} variant="outline">
              {label}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground">
            Selection and time interval follow the stage — details open only when useful.
          </span>
        </div>

        <div className="grid gap-2 rounded-xl border border-border/50 bg-muted/10 p-4 text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">Annotation legend</p>
          <p>
            <span className={annotation} aria-hidden="true">
              1
            </span>{" "}
            Document identity with one persistence state; “Changed since last verified run” is
            separate from Saved.
          </p>
          <p>
            <span className={annotation} aria-hidden="true">
              2
            </span>{" "}
            The resolved configuration is visible before input. The same composer opens from a Test,
            Plan, goal, live comparison, or Change verification.
          </p>
          <p>
            <span className={annotation} aria-hidden="true">
              3
            </span>{" "}
            Record, Ask Relay, and Capture are actions of this workspace — not routes to other
            applications.
          </p>
          <p>
            <span className={annotation} aria-hidden="true">
              4
            </span>{" "}
            The application stage never relocates when the mode changes.
          </p>
          <p>
            <span className={annotation} aria-hidden="true">
              5
            </span>{" "}
            Steps read as the object they manipulate.
          </p>
          <p>
            <span className={annotation} aria-hidden="true">
              6
            </span>{" "}
            Exactly five operating states; each is explicit and reversible.
          </p>
        </div>
      </div>
    </WorkbenchPage>
  );
}
