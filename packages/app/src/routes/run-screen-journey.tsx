import { Circle, CircleCheck, Dot, GitBranch } from "lucide-react";
import type { RunScreenJourney as Journey } from "../data/run-screen-journey";

/** Execution follows the saved path; only proven observations can draw a branch. */
export function RunScreenJourney({ journey }: { journey: Journey }) {
  if (!journey.planned.length && !journey.observed.length && !journey.current) return null;
  const branches = journey.observed.filter((visit) => visit.branch);
  const currentScreenId =
    journey.current?.status === "proven" ? journey.current.screenId : undefined;
  const latestVisit = journey.observed.at(-1);
  const currentBranch =
    latestVisit?.branch &&
    latestVisit.screenId === currentScreenId &&
    !journey.planned.some((screen) => screen.state === "current")
      ? latestVisit
      : undefined;
  const isHere = (branch: Journey["observed"][number]) => branch === currentBranch;
  return (
    <section aria-label="Screen path" className="shrink-0 border-b border-border px-5 py-3">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <GitBranch className="size-3.5" aria-hidden="true" /> Screen path
      </h2>
      <ol className="max-h-56 overflow-y-auto text-sm">
        {journey.planned.map((screen, index) => (
          <li
            key={screen.id}
            aria-current={screen.state === "current" ? "location" : undefined}
            className="relative pb-3 last:pb-0"
          >
            {index < journey.planned.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-4 bottom-0 left-2 border-l border-border"
              />
            ) : null}
            {screen.via ? (
              <p className="mb-1 pl-7 text-xs text-muted-foreground">{screen.via.label}</p>
            ) : null}
            <div
              className={`relative flex items-center gap-3 ${screen.state === "current" ? "font-medium text-info" : screen.state === "pending" ? "text-muted-foreground" : "text-foreground"}`}
            >
              {screen.state === "visited" ? (
                <CircleCheck
                  className="size-4 shrink-0 bg-card text-success"
                  aria-label={
                    screen.fact === "observed" ? "Observed screen" : "Screen check passed"
                  }
                />
              ) : screen.state === "current" ? (
                <Dot
                  className="size-4 shrink-0 rounded-full bg-info/15"
                  aria-label={
                    screen.fact === "observed"
                      ? "Observed current screen"
                      : "Current screen confirmed by check"
                  }
                />
              ) : (
                <Circle className="size-4 shrink-0 bg-card" aria-label="Planned" />
              )}
              <span className="min-w-0 break-words">{screen.title}</span>
              {screen.state === "current" ? (
                <span className="ml-auto shrink-0 text-xs">Here</span>
              ) : null}
            </div>
            {branches
              .filter((branch) => branch.fromWaypointId === screen.id)
              .map((branch) => (
                <div
                  key={`${branch.screenId}:${branch.at}`}
                  aria-current={isHere(branch) ? "location" : undefined}
                  className="mt-2 ml-2 border-l border-warning/40 py-1 pl-5 text-xs"
                >
                  <span className="text-muted-foreground">Observed branch</span>
                  <p className="mt-1 text-foreground">
                    {branch.title}
                    {isHere(branch) ? <span className="ml-2 text-info">Here</span> : null}
                  </p>
                </div>
              ))}
          </li>
        ))}
      </ol>
      {branches
        .filter((branch) => !journey.planned.some((screen) => screen.id === branch.fromWaypointId))
        .map((branch) => (
          <p
            key={`${branch.screenId}:${branch.at}`}
            aria-current={isHere(branch) ? "location" : undefined}
            className="mt-2 text-xs text-muted-foreground"
          >
            Observed outside the saved path: <span className="text-foreground">{branch.title}</span>
            {isHere(branch) ? <span className="ml-2 text-info">Here</span> : null}
          </p>
        ))}
      {journey.current?.status === "unknown" ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          Current screen is being checked.
        </p>
      ) : journey.current?.status === "external-handoff" ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          The device opened another app.
        </p>
      ) : null}
      {journey.current?.status === "proven" &&
      !currentBranch &&
      !journey.planned.some((screen) => screen.state === "current") ? (
        <p className="mt-2 text-xs text-info" role="status">
          Here: {journey.current.title}
        </p>
      ) : null}
    </section>
  );
}
