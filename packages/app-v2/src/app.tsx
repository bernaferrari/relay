/** @jsxImportSource react */
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { applyColorScheme, readColorScheme } from "./data/appearance-preference";
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
  createChangeProductService,
  type ChangeProductService,
} from "./data/change-product-service";
import {
  createTestEditorProductService,
  type TestEditorProductService,
} from "./data/test-editor-product-service";
import type { Platform } from "./platform/types";
import { createAppRouter } from "./router/create-router";

function AppearanceSync({ platform }: { platform: Platform }) {
  useEffect(() => {
    let active = true;
    let preference: "system" | "light" | "dark" = "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystem = () => {
      if (active && preference === "system") applyColorScheme("system");
    };
    media.addEventListener("change", updateSystem);
    void readColorScheme(platform).then((next) => {
      if (!active) return;
      preference = next;
      applyColorScheme(next);
    });
    return () => {
      active = false;
      media.removeEventListener("change", updateSystem);
    };
  }, [platform]);
  return null;
}

export function RelayV2App({
  platform,
  history,
  productService,
  appResourcesService,
  runService,
  catalogService,
  deviceService,
  settingsService,
  changeService,
  runAcrossService,
  mapService,
  testEditorService,
}: {
  platform: Platform;
  history?: RouterHistory;
  productService?: RecordingProductService;
  appResourcesService?: AppResourcesProductService;
  runService?: RunProductService;
  catalogService?: CatalogProductService;
  deviceService?: DeviceProductService;
  settingsService?: SettingsProductService;
  changeService?: ChangeProductService;
  runAcrossService?: RunAcrossProductService;
  mapService?: MapProductService;
  testEditorService?: TestEditorProductService;
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
  const [changes] = useState(() => changeService ?? createChangeProductService(platform));
  const [testEditor] = useState(
    () => testEditorService ?? createTestEditorProductService(platform),
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
      changeService: changes,
      testEditorService: testEditor,
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
