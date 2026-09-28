/** @jsxImportSource react */
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageLoading } from "./recording-shared";
import { TestEditor } from "./edit-test-page";

const routeApi = getRouteApi("/tests/$testId/edit");

/** Editing lives on the Test page. This route only hosts live device sessions. */
export function EditTestPage() {
  const { testId } = routeApi.useParams();
  const search = routeApi.useSearch() as { step?: unknown; session?: unknown; app?: unknown };
  const navigate = useNavigate({ from: "/tests/$testId/edit" });
  const sessionId = typeof search.session === "string" ? search.session : undefined;
  const stepId = typeof search.step === "string" ? search.step : undefined;
  const appMapId = typeof search.app === "string" ? search.app : undefined;
  useEffect(() => {
    if (sessionId) return;
    void navigate({
      to: "/tests/$testId",
      params: { testId },
      search: { ...(stepId ? { step: stepId } : {}), ...(appMapId ? { app: appMapId } : {}) },
      replace: true,
    });
  }, [appMapId, navigate, sessionId, stepId, testId]);
  if (!sessionId) return <PageLoading label="Opening the Test…" />;
  return (
    <TestEditor
      key={`${appMapId ?? "unscoped"}:${testId}`}
      testId={testId}
      appMapId={appMapId}
      sessionId={sessionId}
      stepId={stepId}
      onStepChange={(step) =>
        void navigate({ search: (previous) => ({ ...previous, step }), replace: true })
      }
    />
  );
}
