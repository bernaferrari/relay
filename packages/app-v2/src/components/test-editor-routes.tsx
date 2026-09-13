/** @jsxImportSource react */
import type { AppMapScenarioTest } from "@relay/protocol";
import {
  testRoutePlatformStatuses,
  unrecordedNativeEditorNotice,
  type PlanPlatform,
} from "@relay/product/test-route-platforms";

export function TestEditorRoutes({
  test,
  recordedPlatforms,
}: {
  test: AppMapScenarioTest;
  recordedPlatforms?: readonly PlanPlatform[];
}) {
  const statuses = testRoutePlatformStatuses(test, { recordedPlatforms });
  const nativeNotice = unrecordedNativeEditorNotice(statuses);
  return (
    <section className="grid gap-2" aria-labelledby="test-routes-title">
      <h2 id="test-routes-title" className="text-sm font-semibold">
        Platforms
      </h2>
      <p className="text-xs leading-snug text-muted-foreground">
        One Test. Web, Android, and iOS routes stay visible even when a platform is not recorded.
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
                {item.status === "reviewed" ? "Recorded" : "Not recorded"}
              </span>
            </strong>
            {item.reason ? (
              <p className="text-[11px] leading-snug text-muted-foreground">{item.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {nativeNotice ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{nativeNotice}</p>
      ) : null}
    </section>
  );
}
