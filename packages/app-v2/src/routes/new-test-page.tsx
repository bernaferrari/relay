/** @jsxImportSource react */
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  RadioCard,
  RadioGroup,
  ScrollArea,
  Skeleton,
} from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { AppWindow, ArrowLeft, Check, CircleDot, Monitor, Play, Smartphone } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { recordingQueryKeys } from "../data/recording-queries";
import {
  clearWorkflowPointerIfCurrent,
  readWorkflowPointer,
  writeWorkflowPointer,
} from "../data/workflow-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";

export function NewTestPage() {
  const { mapService, platform, productService, queryClient } = useRouteContext({
    from: "__root__",
  });
  const rawSearch = useLocation({ select: (state) => state.search });
  const search = rawSearch as Readonly<Record<string, unknown>>;
  const requestedAppId = typeof search.app === "string" ? search.app : undefined;
  const requestedPathId = typeof search.path === "string" ? search.path : undefined;
  const startsFromPath = search.view === "path" && Boolean(requestedAppId && requestedPathId);
  const navigate = useNavigate();
  const [appId, setAppId] = useState(requestedAppId ?? "");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");

  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
  });
  const targets = useQuery({
    queryKey: recordingQueryKeys.targets,
    queryFn: async () => {
      const state = await productService.connect();
      return { ...state, targetOptions: await productService.presentTargets(state.targets) };
    },
    staleTime: 5_000,
  });
  const activePointer = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => {
      const workflowId = await readWorkflowPointer(platform);
      if (!workflowId) return null;
      const current = await productService.inspect(workflowId);
      const stage = current.snapshot?.stage;
      if (!current.recovery && (stage === "cancelled" || stage === "committed")) {
        await clearWorkflowPointerIfCurrent(platform, workflowId);
        return null;
      }
      return workflowId;
    },
    staleTime: Infinity,
  });
  const pathContext = useQuery({
    queryKey: ["map", requestedAppId, "recording-path", requestedPathId],
    queryFn: async () => {
      const map = await mapService.get(requestedAppId!);
      return map.paths.find((path) => path.id === requestedPathId) ?? null;
    },
    enabled: startsFromPath,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!title && pathContext.data) {
      setTitle(`${pathContext.data.fromTitle} to ${pathContext.data.toTitle ?? "Finish"}`);
    }
  }, [pathContext.data, title]);

  const begin = useMutation({
    mutationFn: async () => {
      const state = await productService.begin({ title: title.trim(), appMapId: appId, targetId });
      const workflowId = state.snapshot?.workflow?.workflowId;
      if (workflowId) {
        await writeWorkflowPointer(platform, workflowId);
        queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, workflowId);
      } else if (!state.recovery) {
        throw new TypeError("Relay could not start this recording.");
      }
      return state;
    },
    onSuccess: async (state) => {
      if (state.recovery) return;
      const workflowId = state.snapshot?.workflow?.workflowId;
      if (!workflowId) return;
      await navigate({ to: "/tests/$testId/record", params: { testId: workflowId } });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !appId || !targetId || begin.isPending) return;
    begin.mutate();
  }

  const loading = apps.isPending || activePointer.isPending;
  const noApps = apps.data?.length === 0;
  const noTargets = targets.data?.targetOptions.length === 0;
  const formReady = Boolean(title.trim() && appId && targetId && !begin.isPending);
  const appChoices = (
    <RadioGroup
      className="relay-choice-group relay-choice-group--apps"
      name="app"
      value={appId}
      onValueChange={setAppId}
      aria-labelledby="test-app-title"
      required
    >
      {apps.data?.map((app) => (
        <RadioCard
          key={app.id}
          value={app.id}
          title={app.name}
          description="Saved App"
          leading={<AppWindow />}
        />
      ))}
    </RadioGroup>
  );

  return (
    <section className="relay-page relay-new-test-page">
      <Link className="relay-back-link" to="/tests">
        <ArrowLeft aria-hidden="true" /> Tests
      </Link>
      <header className="relay-page-header relay-new-test-header">
        <div>
          <h1>Record a Test</h1>
          <p className="relay-page-description">
            Choose one recognizable journey and where to record it. Relay handles the technical
            setup.
          </p>
        </div>
      </header>

      {activePointer.data ? (
        <Alert className="relay-resume-recording" variant="info">
          <AlertIcon>
            <CircleDot />
          </AlertIcon>
          <AlertTitle>
            {begin.data?.recovery
              ? "Recording status needs review"
              : "A recording is already in progress"}
          </AlertTitle>
          <AlertDescription>
            <p>
              {begin.data?.recovery
                ? "Open the saved recording to inspect its latest server state."
                : "Continue the recording you started before creating another Test."}
            </p>
          </AlertDescription>
          <AlertActions>
            <Button
              size="small"
              onClick={() =>
                void navigate({
                  to: "/tests/$testId/record",
                  params: { testId: activePointer.data! },
                })
              }
            >
              Open recording
            </Button>
          </AlertActions>
        </Alert>
      ) : null}

      {loading ? <PageLoading label="Finding your apps and ready devices…" /> : null}
      <RecordingProblem
        error={apps.error ?? targets.error ?? pathContext.error ?? begin.error}
        recovery={begin.data?.recovery ?? targets.data?.recovery}
        onRetry={
          begin.data?.recovery && activePointer.data
            ? undefined
            : () => {
                void apps.refetch();
                void targets.refetch();
              }
        }
        retrying={apps.isFetching || targets.isFetching}
      />

      {!loading &&
      !apps.isError &&
      !targets.isError &&
      !targets.data?.recovery &&
      !activePointer.data ? (
        <div className="relay-new-test-layout">
          <form className="relay-recording-form" onSubmit={submit}>
            <Card className="relay-new-test-card">
              <CardHeader>
                <CardTitle>Set up the recording</CardTitle>
                <CardDescription>
                  You can change the name later. The app and target stay attached to this recording.
                </CardDescription>
              </CardHeader>
              <CardContent className="relay-new-test-fields">
                {startsFromPath ? (
                  <Alert variant="info">
                    <AlertIcon>
                      <Check />
                    </AlertIcon>
                    <AlertTitle>
                      {pathContext.data
                        ? `${pathContext.data.fromTitle} → ${pathContext.data.toTitle ?? "Finish"}`
                        : "Verified path selected"}
                    </AlertTitle>
                    <AlertDescription>
                      Relay will use this known path as the starting context for the recording.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Field className="relay-test-name-field">
                  <FieldLabel htmlFor="test-name">What should this Test prove?</FieldLabel>
                  <Input
                    id="test-name"
                    value={title}
                    onChange={(event) => setTitle(event.currentTarget.value)}
                    placeholder="For example, Change the app language"
                    maxLength={160}
                    autoComplete="off"
                    spellCheck
                  />
                  <FieldDescription>
                    Use the outcome a teammate would recognize in a Report.
                  </FieldDescription>
                </Field>

                <Field>
                  <div className="relay-choice-heading">
                    <div className="relay-field-label" id="test-app-title">
                      App
                    </div>
                    <FieldDescription>Where this Test belongs</FieldDescription>
                  </div>
                  {noApps ? (
                    <div className="relay-choice-empty">
                      <strong>No apps are available</strong>
                      <p>Add an app before recording a Test.</p>
                      <Link className="relay-inline-link" to="/apps">
                        Manage apps
                      </Link>
                    </div>
                  ) : (apps.data?.length ?? 0) > 4 ? (
                    <ScrollArea className="relay-choice-scroll">{appChoices}</ScrollArea>
                  ) : (
                    appChoices
                  )}
                </Field>

                <Field>
                  <div className="relay-choice-heading">
                    <div className="relay-field-label" id="test-target-title">
                      Device or browser
                    </div>
                    <FieldDescription>Where Relay will record</FieldDescription>
                  </div>
                  {targets.isPending ? (
                    <div className="relay-choice-group relay-choice-group--loading" role="status">
                      <span className="relay-visually-hidden">
                        Finding ready devices and browsers…
                      </span>
                      <Skeleton />
                      <Skeleton />
                    </div>
                  ) : targets.isError ? (
                    <div className="relay-choice-empty">
                      <strong>Targets are not available yet</strong>
                      <p>Use Try again above after the local Relay service is running.</p>
                    </div>
                  ) : noTargets ? (
                    <div className="relay-choice-empty">
                      <strong>Nothing is ready to record</strong>
                      <p>Connect a device or start a managed browser, then try again.</p>
                      <Link className="relay-inline-link" to="/devices">
                        View devices
                      </Link>
                    </div>
                  ) : (
                    <RadioGroup
                      className="relay-choice-group"
                      name="target"
                      value={targetId}
                      onValueChange={setTargetId}
                      aria-labelledby="test-target-title"
                      required
                    >
                      {targets.data?.targetOptions.map((target) => {
                        const label = targetLabel(target);
                        return (
                          <RadioCard
                            key={`${target.kind}:${target.targetId}`}
                            value={target.targetId}
                            title={label.title}
                            description={label.detail}
                            leading={target.kind === "browser" ? <Monitor /> : <Smartphone />}
                          />
                        );
                      })}
                    </RadioGroup>
                  )}
                </Field>
              </CardContent>
              <CardFooter className="relay-form-actions">
                <Button type="submit" variant="primary" disabled={!formReady}>
                  <Play aria-hidden="true" />
                  {begin.isPending ? "Starting…" : "Begin recording"}
                </Button>
                <Button render={<Link to="/tests" />} variant="ghost">
                  Cancel
                </Button>
                <span className="relay-form-readiness" aria-live="polite">
                  {formReady ? (
                    <>
                      <Check aria-hidden="true" /> Ready to record
                    </>
                  ) : (
                  "Add a name, app, and target"
                  )}
                </span>
              </CardFooter>
            </Card>
          </form>
        </div>
      ) : null}
    </section>
  );
}
