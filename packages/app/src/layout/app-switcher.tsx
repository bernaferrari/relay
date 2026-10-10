/** @jsxImportSource react */
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@relay/ui-react/components/dropdown-menu";
import type { ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Map, ChevronDown } from "lucide-react";
import { SidebarMenuButton } from "@relay/ui-react/components/sidebar";
import { platformLabel, type AppPlatform } from "../data/app-families";
import { appContextDestination, appScopeDisplayName } from "./app-scope";
import { useCurrentAppScope } from "./use-current-app-scope";

/** The App choice, then the everyday links (children), then that App's map. */
export function AppSwitcher({ children }: { children?: ReactNode } = {}) {
  const router = useRouter();
  const { location, apps, scope, selectedAppId, selectedApp } = useCurrentAppScope();
  const contextName =
    selectedApp?.name ?? appScopeDisplayName(scope, apps.data, apps.isSuccess || apps.isError);
  // One product, several platforms: "Shop" with Web / iOS / Android under it.
  const families = groupFamilies(apps.data ?? []);
  const selectedOption = apps.data?.find((app) => app.id === selectedAppId);
  const selectedFamily = families.find((family) =>
    family.apps.some((app) => app.id === selectedAppId),
  );
  const triggerName =
    selectedFamily && selectedFamily.apps.length > 1 ? selectedFamily.name : contextName;
  const triggerDetail =
    selectedFamily && selectedFamily.apps.length > 1
      ? platformLabel(selectedOption?.platform)
      : "App";

  const triggerSubtitle = selectedAppId
    ? triggerDetail
    : scope.kind === "all" || scope.kind === "workspace"
      ? "Everything"
      : undefined;

  function switchApp(appId?: string) {
    router.history.push(
      appContextDestination({ pathname: location.pathname, search: location.search, appId }),
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2 py-1.5 text-left text-foreground shadow-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
          aria-label={`App: ${contextName}`}
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-xs font-semibold text-brand"
          >
            {triggerName.trim().charAt(0).toUpperCase() || "A"}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium leading-5">{triggerName}</span>
            {triggerSubtitle ? (
              <span className="truncate text-xs leading-4 text-muted-foreground">
                {triggerSubtitle}
              </span>
            ) : null}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          sideOffset={8}
          align="start"
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[min(28rem,70vh)] p-1.5"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 py-2 text-xs font-medium text-muted-foreground">
              Choose an app
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={
                scope.kind === "all" || scope.kind === "workspace" ? "__all" : (selectedAppId ?? "")
              }
              onValueChange={(value) => switchApp(value === "__all" ? undefined : value)}
            >
              <DropdownMenuRadioItem
                closeOnClick
                value="__all"
                className="min-h-14 py-2.5 pl-3 pr-8"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium">All apps</span>
                  <span className="text-xs text-muted-foreground">Tests and runs across apps</span>
                </span>
              </DropdownMenuRadioItem>
              {families.map((family) =>
                family.apps.length > 1 ? (
                  <div key={family.id} role="group" aria-label={family.name}>
                    <div className="px-3 pt-2.5 pb-1 text-xs font-semibold text-foreground">
                      {family.name}
                    </div>
                    {family.apps.map((app) => (
                      <DropdownMenuRadioItem
                        key={app.id}
                        closeOnClick
                        value={app.id}
                        className="min-h-10 py-2 pl-5 pr-8"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm leading-5">{platformLabel(app.platform)}</span>
                          <span className="truncate text-xs text-muted-foreground">{app.name}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </div>
                ) : (
                  <DropdownMenuRadioItem
                    key={family.id}
                    closeOnClick
                    value={family.apps[0]!.id}
                    className="min-h-12 py-3 pl-3 pr-8"
                  >
                    <span className="whitespace-normal text-sm leading-5">
                      {family.apps[0]!.name}
                    </span>
                  </DropdownMenuRadioItem>
                ),
              )}
            </DropdownMenuRadioGroup>
            {apps.isError ? (
              <DropdownMenuItem
                className="flex min-h-11 items-center px-2.5 text-xs text-muted-foreground"
                disabled
              >
                Apps are temporarily unavailable
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator className="my-2 ml-1.5 mr-1.5 mt-2 h-px bg-border" />
            <DropdownMenuItem
              className="focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 flex justify-between gap-4"
              onClick={() => router.history.push("/apps")}
            >
              Manage apps
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {children}
      <nav aria-label="App navigation" className="pt-0.5">
        {selectedAppId ? (
          <SidebarMenuButton
            render={<Link to="/apps/$appId/map" params={{ appId: selectedAppId }} />}
            isActive={/^\/apps\/[^/]+\/map/.test(location.pathname)}
            aria-current={/^\/apps\/[^/]+\/map/.test(location.pathname) ? "page" : undefined}
            className="min-h-9 gap-2.5 px-2.5 text-sm font-medium"
          >
            <Map className="size-4 text-muted-foreground" aria-hidden="true" />
            Map
          </SidebarMenuButton>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<SidebarMenuButton className="min-h-9 gap-2.5 px-2.5 text-sm font-medium" />}
              aria-label="App map"
            >
              <Map className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-left">Map</span>
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="w-80 max-w-[calc(100vw-2rem)] max-h-[min(28rem,70vh)] p-1.5"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-3 py-2 text-xs font-medium text-muted-foreground">
                  Choose an app to map
                </DropdownMenuLabel>
                {apps.data?.map((app) => (
                  <MapPickerItem
                    key={app.id}
                    app={app}
                    onSelect={() => router.history.push(`/apps/${encodeURIComponent(app.id)}/map`)}
                  />
                ))}
                {apps.isPending ? (
                  <DropdownMenuItem disabled>Loading apps…</DropdownMenuItem>
                ) : null}
                {apps.isError ? (
                  <DropdownMenuItem onClick={() => void apps.refetch()}>
                    Couldn’t load apps · Retry
                  </DropdownMenuItem>
                ) : null}
                {apps.isSuccess && !apps.data.length ? (
                  <DropdownMenuItem onClick={() => router.history.push("/apps")}>
                    Add an app
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </>
  );
}

type AppOption = {
  id: string;
  name: string;
  platform?: AppPlatform;
  familyId?: string;
  familyName?: string;
};

const PLATFORM_ORDER: Record<string, number> = { web: 0, ios: 1, android: 2 };

/** Families in first-seen order; platforms inside a family Web, iOS, Android. */
function groupFamilies(apps: readonly AppOption[]) {
  const families: { id: string; name: string; apps: AppOption[] }[] = [];
  for (const app of apps) {
    const id = app.familyId ?? app.id;
    let family = families.find((item) => item.id === id);
    if (!family) {
      family = { id, name: app.familyName ?? app.name, apps: [] };
      families.push(family);
    }
    family.apps.push(app);
  }
  for (const family of families) {
    family.apps.sort(
      (left, right) =>
        (PLATFORM_ORDER[left.platform ?? ""] ?? 3) - (PLATFORM_ORDER[right.platform ?? ""] ?? 3),
    );
  }
  return families;
}

function MapPickerItem({
  app,
  onSelect,
}: {
  app: { id: string; name: string };
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onClick={onSelect} className="min-h-10 rounded-md px-3 py-2">
      <span className="w-full whitespace-normal text-sm font-medium leading-5">{app.name}</span>
    </DropdownMenuItem>
  );
}
