import { FlaskConical, History, MonitorSmartphone } from "lucide-react";

/**
 * One destination vocabulary for the sidebar and command palette, per the
 * product hierarchy: Tests (home, with plans as groups) and Runs are
 * everyday, and Map follows the chosen App. Screenshot review lives inside
 * Runs. Devices provides free control before authoring, and holds browser sign-ins.
 * Everything else is reachable from search.
 */
export const everydayDestinations = [
  {
    to: "/tests",
    label: "Tests",
    shortLabel: "Tests",
    icon: FlaskConical,
    detail: "Your tests and test plans, and what needs you",
    keywords: "home today record test suite plan",
  },
  {
    to: "/runs",
    label: "Runs",
    shortLabel: "Runs",
    icon: History,
    detail: "Every run, live and finished, and screenshots to review",
    keywords: "results reports evidence history review screenshots approve",
  },
  {
    to: "/devices",
    label: "Devices",
    shortLabel: "Devices",
    icon: MonitorSmartphone,
    detail: "Control a browser, phone, or tablet without creating a test",
    keywords:
      "targets environments browsers devices free roam live control explore accounts logins sign-ins",
  },
] as const;

/** Sign-ins belong to browsers (one browser, one account), so they live in Devices. */
export const primaryDestinations = everydayDestinations;
