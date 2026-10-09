/** @jsxImportSource react */
import type { AppMapScenarioTest } from "@relay/protocol";
import {
  testRoutePlatformStatuses,
  unrecordedNativeEditorNotice,
  type PlanPlatform,
} from "@relay/product/test-route-platforms";

function platformRowLabel(status: "reviewed" | "unrecorded" | "linked" | "blocked"): string {
  if (status === "reviewed") return "Recorded";
  if (status === "linked") return "Linked";
  if (status === "blocked") return "Blocked";
  return "Not recorded";
}

export function TestEditorRoutes({
  test,
  recordedPlatforms,
  routePlatformBlockers,
}: {
  test: AppMapScenarioTest;
  recordedPlatforms?: readonly PlanPlatform[];
  routePlatformBlockers?: Partial<Record<PlanPlatform, string>>;
}) {
  const statuses = testRoutePlatformStatuses(test, {
    recordedPlatforms,
    platformBlockers: routePlatformBlockers,
  });
  const nativeNotice = unrecordedNativeEditorNotice(statuses);
  return (
    <section className="grid gap-2" aria-labelledby="test-routes-title">
      <h2 id="test-routes-title" className="text-sm font-semibold">
        Platforms
      </h2>
      <p className="text-xs leading-snug text-muted-foreground">
        One test. Web, Android, and iOS routes stay visible even when a platform is not recorded.
      </p>
      <ul className="grid list-none gap-1.5 p-0">
        {statuses.map((item) => (
          <li
            key={item.platform}
            className="grid gap-0.5 rounded-lg border border-border bg-card px-3 py-2"
          >
            <strong className="text-xs font-semibold">
              {item.label}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {platformRowLabel(item.status)}
              </span>
            </strong>
            {item.reason ? (
              <p className="text-xs leading-snug text-muted-foreground">{item.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {nativeNotice ? (
        <p className="text-xs leading-snug text-muted-foreground">{nativeNotice}</p>
      ) : null}
    </section>
  );
}
