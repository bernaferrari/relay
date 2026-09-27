import {
  Activity,
  FlaskConical,
  GitCompare,
  History,
  KeyRound,
  MonitorSmartphone,
  ScanEye,
} from "lucide-react";

/**
 * One destination vocabulary for the sidebar and command palette, per the
 * product hierarchy: Tests (home, with plans as groups), Review, and Results
 * are everyday; Map follows the chosen App; Devices is setup. Everything
 * else is reachable from search.
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
    detail: "Every run, live and finished",
    keywords: "reports evidence runs history",
  },
] as const;

/** Setup that people visit now and then; shown under the everyday links. */
export const utilityDestinations = [
  {
    to: "/devices",
    label: "Devices",
    shortLabel: "Devices",
    icon: MonitorSmartphone,
    detail: "Browsers, phones, and tablets Relay can use",
    keywords: "targets environments browsers devices",
  },
  {
    to: "/accounts",
    label: "Accounts",
    shortLabel: "Accounts",
    icon: KeyRound,
    detail: "Saved logins your tests can run as",
    keywords: "accounts logins sign-ins sign in users credentials",
  },
] as const;

/** Reachable from search (⌘K) and links, not the sidebar. */
export const moreDestinations = [
  {
    to: "/sessions",
    label: "Activity",
    shortLabel: "Activity",
    icon: Activity,
    detail: "Recordings and live sessions",
    keywords: "sessions activity live recordings",
  },
  {
    to: "/changes",
    label: "Changes",
    shortLabel: "Changes",
    icon: GitCompare,
    detail: "Verify a code change against your tests",
    keywords: "changes proof verification pull request",
  },
] as const;

export const primaryDestinations = [
  ...everydayDestinations,
  ...utilityDestinations,
  ...moreDestinations,
];
