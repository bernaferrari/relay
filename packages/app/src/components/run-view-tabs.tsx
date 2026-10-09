import { TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import type { ProductRunReportOverview } from "../data/run-report-model";

/** One navigation model for the run summary and all retained evidence. What
 * happened and its screenshots are tabs; engineering detail sits one click
 * away under Details, and becomes a tab while it is open. */
export function RunViewTabs({
  report,
  value,
  onSelect,
}: {
  report: ProductRunReportOverview;
  value?: string;
  onSelect?(value: string): void;
}) {
  const primary: [string, string][] = [
    ["story", "Overview"],
    ...(report.captureReview?.items.length ||
    report.evidence.some((section) => section.id === "screenshot" && section.items.length) ||
    report.timeline.some((step) => step.framePaths?.length)
      ? ([["captures", "Screenshots"]] as [string, string][])
      : []),
  ];
  const details: [string, string][] = [
    ["steps", "Steps"],
    ...(report.timeline.some((step) => step.expected?.trim())
      ? ([["details", "Checks"]] as [string, string][])
      : []),
    ...(report.performance?.length ? ([["performance", "Performance"]] as [string, string][]) : []),
    ["logs", "Logs"],
    ...(report.evidence.some((section) => section.id === "network" && section.items.length)
      ? ([["network", "Network"]] as [string, string][])
      : []),
  ];
  const openDetail = details.find(([id]) => id === value);
  const visible = openDetail ? [...primary, openDetail] : primary;
  return (
    <div
      className="flex shrink-0 items-center overflow-x-auto overflow-y-hidden border-y border-border pr-3"
      data-slot="run-view-tabs"
    >
      <TabsList
        variant="line"
        className="group-data-horizontal/tabs:h-12 w-max justify-start gap-3 px-5 py-0"
        aria-label="Run views"
      >
        {visible.map(([id, label]) => (
          <TabsTrigger
            key={id}
            value={id}
            className="h-11 flex-none px-2 transition-colors after:bottom-0"
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {onSelect ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="ml-1 inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="More run details"
          >
            Details <ChevronDown className="size-3.5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {details.map(([id, label]) => (
              <DropdownMenuItem key={id} onClick={() => onSelect(id)}>
                {label}
                {id === value ? <Check className="ml-auto" aria-hidden="true" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
