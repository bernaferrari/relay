import { TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import type { ProductRunReportOverview } from "../data/run-report-model";

/** One navigation model for the run summary and all retained evidence. */
export function RunViewTabs({ report }: { report: ProductRunReportOverview }) {
  const views = [
    ["story", "Overview"],
    ["steps", "Steps"],
    ...(report.captureReview?.items.length ||
    report.evidence.some((section) => section.id === "screenshot" && section.items.length) ||
    report.timeline.some((step) => step.framePaths?.length)
      ? [["captures", "Screenshots"]]
      : []),
    ...(report.performance?.length ? [["performance", "Performance"]] : []),
    ...(report.timeline.some((step) => step.expected?.trim()) ? [["details", "Checks"]] : []),
    ["logs", "Logs"],
    ...(report.evidence.some((section) => section.id === "network" && section.items.length)
      ? [["network", "Network"]]
      : []),
  ];
  return (
    <div
      className="shrink-0 overflow-x-auto overflow-y-hidden border-y border-border"
      data-slot="run-view-tabs"
    >
      <TabsList
        variant="line"
        className="group-data-horizontal/tabs:h-12 w-max min-w-full justify-start gap-3 px-5 py-0"
        aria-label="Run views"
      >
        {views.map(([value, label]) => (
          <TabsTrigger
            key={value}
            value={value}
            className="h-11 flex-none px-2 transition-colors after:bottom-0"
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
