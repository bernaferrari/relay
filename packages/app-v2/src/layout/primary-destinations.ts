import { Compass, FlaskConical, History, Layers3, MonitorSmartphone } from "lucide-react";

/** One destination vocabulary for the sidebar and command palette. */
export const primaryDestinations = [
  {
    to: "/goals",
    label: "Explore",
    icon: Compass,
    detail: "Start from a goal",
    keywords: "goal agent openrouter",
  },
  {
    to: "/tests",
    label: "Tests",
    icon: FlaskConical,
    detail: "Reusable journeys",
    keywords: "record test",
  },
  {
    to: "/suites",
    label: "Plans",
    icon: Layers3,
    detail: "Tests and data sets run together",
    keywords: "suite batch",
  },
  {
    to: "/runs",
    label: "Results",
    icon: History,
    detail: "Current and completed runs",
    keywords: "reports evidence",
  },
  {
    to: "/devices",
    label: "Devices",
    icon: MonitorSmartphone,
    detail: "Connected browsers and devices",
    keywords: "targets",
  },
] as const;
