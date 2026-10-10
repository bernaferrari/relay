/** @jsxImportSource react */
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  applyColorScheme,
  readColorScheme,
  colorSchemeVersion,
  validColorScheme,
} from "./data/appearance-preference";
import {
  createAppResourcesProductService,
  type AppResourcesProductService,
} from "./data/app-resources-product-service";
import {
  createCatalogProductService,
  type CatalogProductService,
} from "./data/catalog-product-service";
import {
  createDeviceProductService,
  type DeviceProductService,
} from "./data/device-product-service";
import { createRelayQueryClient } from "./data/query-client";
import {
  createRecordingProductService,
  type RecordingProductService,
} from "./data/recording-product-service";
import { createRunProductService, type RunProductService } from "./data/run-product-service";
import {
  createRunAcrossProductService,
  type RunAcrossProductService,
} from "./data/run-across-product-service";
import { createMapProductService, type MapProductService } from "./data/map-product-service";
import {
  createSettingsProductService,
  type SettingsProductService,
} from "./data/settings-product-service";
import {
  createSuiteProfileProductService,
  type SuiteProfileProductService,
} from "./data/suite-profile-product-service";
import {
  createBrowserSpacesProductService,
  type BrowserSpacesProductService,
} from "./data/browser-spaces-product-service";
import {
  createTestEditorProductService,
  type TestEditorProductService,
} from "./data/test-editor-product-service";
import type { Platform } from "./platform/types";
import { createAppRouter } from "./router/create-router";

function AppearanceSync({ platform }: { platform: Platform }) {
  useEffect(() => {
    let active = true;
    const startingVersion = colorSchemeVersion();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystem = () => {
      if (
        active &&
        validColorScheme(document.documentElement.dataset.colorSchemePreference) === "system"
      )
        applyColorScheme("system");
    };
    media.addEventListener("change", updateSystem);
    void readColorScheme(platform)
      .then((next) => {
        if (!active || startingVersion !== colorSchemeVersion()) return;
        applyColorScheme(next);
      })
      .catch(() => {
        if (active && startingVersion === colorSchemeVersion()) applyColorScheme("system");
      });
    return () => {
      active = false;
      media.removeEventListener("change", updateSystem);
    };
  }, [platform]);
  return null;
}

export function RelayApp({
  platform,
  history,
  productService,
  appResourcesService,
  runService,
  catalogService,
  deviceService,
  settingsService,
  runAcrossService,
  mapService,
  testEditorService,
  suiteProfileService,
  browserSpacesService,
}: {
  platform: Platform;
  history?: RouterHistory;
  productService?: RecordingProductService;
  appResourcesService?: AppResourcesProductService;
  runService?: RunProductService;
  catalogService?: CatalogProductService;
  deviceService?: DeviceProductService;
  settingsService?: SettingsProductService;
  runAcrossService?: RunAcrossProductService;
  mapService?: MapProductService;
  testEditorService?: TestEditorProductService;
  suiteProfileService?: SuiteProfileProductService;
  browserSpacesService?: BrowserSpacesProductService;
}) {
  const [queryClient] = useState(createRelayQueryClient);
  const [service] = useState(() => productService ?? createRecordingProductService(platform));
  const [appResources] = useState(
    () => appResourcesService ?? createAppResourcesProductService(platform),
  );
  const [runs] = useState(() => runService ?? createRunProductService(platform));
  const [runAcross] = useState(() => runAcrossService ?? createRunAcrossProductService(platform));
  const [map] = useState(() => mapService ?? createMapProductService(platform));
  const [catalog] = useState(() => catalogService ?? createCatalogProductService(platform));
  const [devices] = useState(() => deviceService ?? createDeviceProductService(platform));
  const [settings] = useState(() => settingsService ?? createSettingsProductService(platform));
  const [testEditor] = useState(
    () => testEditorService ?? createTestEditorProductService(platform),
  );
  const [suiteProfiles] = useState(
    () => suiteProfileService ?? createSuiteProfileProductService(platform),
  );
  const [browserSpaces] = useState(
    () => browserSpacesService ?? createBrowserSpacesProductService(platform),
  );
  const [router] = useState(() =>
    createAppRouter({
      platform,
      appResourcesService: appResources,
      productService: service,
      runService: runs,
      runAcrossService: runAcross,
      mapService: map,
      catalogService: catalog,
      deviceService: devices,
      settingsService: settings,
      testEditorService: testEditor,
      suiteProfileService: suiteProfiles,
      browserSpacesService: browserSpaces,
      queryClient,
      history,
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceSync platform={platform} />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
