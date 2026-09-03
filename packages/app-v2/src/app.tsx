/** @jsxImportSource react */
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import { useState } from "react";
import { createRelayQueryClient } from "./data/query-client";
import {
  createRecordingProductService,
  type RecordingProductService,
} from "./data/recording-product-service";
import type { Platform } from "./platform/types";
import { createAppRouter } from "./router/create-router";

export function RelayV2App({
  platform,
  history,
  productService,
}: {
  platform: Platform;
  history?: RouterHistory;
  productService?: RecordingProductService;
}) {
  const [queryClient] = useState(createRelayQueryClient);
  const [service] = useState(() => productService ?? createRecordingProductService(platform));
  const [router] = useState(() =>
    createAppRouter({ platform, productService: service, queryClient, history }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
