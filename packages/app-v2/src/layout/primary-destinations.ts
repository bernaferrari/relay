import {
  Activity,
  FlaskConical,
  GitCompare,
  History,
  MonitorSmartphone,
  ScanEye,
} from "lucide-react";

/**
 * One destination vocabulary for the sidebar and command palette, per the
 * frozen product hierarchy (docs/release/PRODUCT-DIRECTION.md): Tests and
 * Results are the two everyday destinations; everything else is a utility.
 * Plans live inside Tests as a collection view; Explore/Ask Relay is a
 * workbench action, not a destination.
 */
export const everydayDestinations = [
  {
    to: "/tests",
    label: "Tests",
    shortLabel: "Tests",
    icon: FlaskConical,
    detail: "Reusable journeys and saved Plans",
    keywords: "record test suite plan",
  },
  {
    to: "/review",
    label: "Review",
    shortLabel: "Review",
    icon: ScanEye,
    detail: "Screenshots that changed since they were approved",
    keywords: "review screenshots approve changed diff reference",
  },
  {
    to: "/runs",
    label: "Results",
    shortLabel: "Results",
    icon: History,
    detail: "Current and completed runs",
    keywords: "reports evidence review",
  },
] as const;

export const utilityDestinations = [
  {
    to: "/devices",
    label: "Devices & browsers",
    shortLabel: "Devices",
    icon: MonitorSmartphone,
    detail: "Connected browsers and devices",
    keywords: "targets environments browsers",
  },
  {
    to: "/sessions",
    label: "Activity",
    shortLabel: "Activity",
    icon: Activity,
    detail: "Live sessions and recent work",
    keywords: "sessions activity live",
  },
  {
    to: "/changes",
    label: "Changes",
    shortLabel: "Changes",
    icon: GitCompare,
    detail: "Repository verification work",
    keywords: "changes proof verification",
  },
] as const;

export const primaryDestinations = [...everydayDestinations, ...utilityDestinations];
