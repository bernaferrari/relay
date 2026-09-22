import { Link } from "@tanstack/react-router";

/** Plans are a collection within Tests; both routes keep the selected app. */
export function TestLibraryNavigation({
  active,
  app,
}: {
  active: "tests" | "plans";
  app?: string;
}) {
  return (
    <nav aria-label="Test library" className="mb-5 flex items-center gap-1 border-b border-border">
      {(
        [
          { id: "tests", to: "/tests", label: "Individual tests" },
          { id: "plans", to: "/suites", label: "Test plans" },
        ] as const
      ).map((item) => (
        <Link
          key={item.id}
          to={item.to}
          search={app ? { app } : {}}
          aria-current={active === item.id ? "page" : undefined}
          className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring ${active === item.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
