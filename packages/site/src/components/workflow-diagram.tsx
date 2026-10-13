import { CircleCheck, MousePointer2, Play, ScanLine } from "lucide-react";
const steps = [
  { icon: MousePointer2, title: "Record", detail: "A real journey" },
  { icon: Play, title: "Replay", detail: "The saved steps" },
  { icon: ScanLine, title: "Inspect", detail: "Run evidence" },
  { icon: CircleCheck, title: "Review", detail: "Your decision" },
];
export function WorkflowDiagram() {
  return (
    <figure
      className="m-0 grid grid-cols-2 gap-6 sm:grid-cols-4"
      aria-label="Record a real journey, replay saved steps, inspect the run's evidence, and keep a review decision"
    >
      {steps.map(({ icon: Icon, title, detail }, index) => (
        <div key={title} className="flex flex-col gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          <strong className="text-sm font-medium">
            {index + 1}. {title}
          </strong>
          <span className="text-xs text-muted-foreground">{detail}</span>
        </div>
      ))}
    </figure>
  );
}
