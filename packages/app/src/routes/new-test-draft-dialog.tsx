/** @jsxImportSource react */
import { APP_MAP_TEST_INTENT_LIMITS } from "@relay/protocol";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Textarea } from "@relay/ui-react/components/textarea";
import { SelectField } from "../components/filter-select";
import { recordingQueryKeys } from "../data/recording-queries";
import { catalogQueryKeys } from "../data/catalog-queries";

export function NewTestDraftDialog() {
  const { productService, testEditorService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
  const [steps, setSteps] = useState("");
  const testId = useRef("");
  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
    enabled: open,
  });
  const instructions = steps
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const stepsError =
    instructions.length > APP_MAP_TEST_INTENT_LIMITS.maxSteps
      ? `Use no more than ${APP_MAP_TEST_INTENT_LIMITS.maxSteps} steps per test.`
      : instructions.some((line) => line.length > APP_MAP_TEST_INTENT_LIMITS.maxIntentLength)
        ? `Keep each step under ${APP_MAP_TEST_INTENT_LIMITS.maxIntentLength + 1} characters.`
        : undefined;
  const ready = Boolean(appId && name.trim() && instructions.length && !stepsError);
  const create = useMutation({
    mutationFn: () =>
      testEditorService.createDraft!({
        appMapId: appId,
        testId: testId.current,
        name,
        instructions,
      }),
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.tests });
      setOpen(false);
      await navigate({ to: "/tests/$testId/edit", params: { testId: document.test.id } });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !create.isPending) create.mutate();
  }
  if (!testEditorService.createDraft) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        if (next) {
          testId.current = `test-${crypto.randomUUID()}`;
          create.reset();
        }
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        Write steps manually
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>Write a test</DialogTitle>
        <DialogDescription>
          Outline the steps now. Connect actions to recorded paths in the editor before running.
        </DialogDescription>
        <form className="grid gap-4" onSubmit={submit}>
          <SelectField
            label="App"
            value={appId}
            disabled={create.isPending}
            options={(apps.data ?? []).map((app) => ({ value: app.id, label: app.name }))}
            placeholder={apps.isPending ? "Loading apps…" : "Choose an app"}
            onValueChange={setAppId}
          />
          {apps.isError ? (
            <p role="alert">
              Could not load apps.{" "}
              <Button type="button" variant="ghost" onClick={() => void apps.refetch()}>
                Try again
              </Button>
            </p>
          ) : null}
          {apps.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add an app through recording setup first, then write its tests here.
            </p>
          ) : null}
          <label className="grid gap-1.5 text-sm" htmlFor="draft-test-name">
            Test name
            <Input
              id="draft-test-name"
              className="text-base"
              value={name}
              maxLength={200}
              disabled={create.isPending}
              placeholder="Generate a video in 720p"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm" htmlFor="draft-test-steps">
            Steps, one per line
            <Textarea
              id="draft-test-steps"
              className="text-base"
              value={steps}
              rows={6}
              disabled={create.isPending}
              placeholder={"Open Imagine\nChoose 720p video\nEnter the prompt\nGenerate the video"}
              onChange={(event) => setSteps(event.currentTarget.value)}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Add waits, uploads, and result checks in the editor. Written instructions stay
            unfinished until you connect them to actions.
          </p>
          {create.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {create.error instanceof Error
                ? create.error.message
                : "Could not create the draft. Try again."}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={create.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? "Creating…" : "Create draft"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
