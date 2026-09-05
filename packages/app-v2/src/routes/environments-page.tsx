/** @jsxImportSource react */
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel as ChoiceLabel } from "@relay/ui-react/components/field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Globe2, Plus, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Breadcrumbs, EmptyState, RecoveryState } from "../components/product-patterns";
import { readSetupContinuation } from "../data/setup-continuation";
import { PageLoading } from "./recording-shared";

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function EnvironmentsPage() {
  const { browserSpacesService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const rawSearch = useLocation({ select: (state) => state.search });
  const rawReturnTo =
    rawSearch && typeof rawSearch === "object" && "returnTo" in rawSearch
      ? String(rawSearch.returnTo)
      : undefined;
  const continuation = rawReturnTo ? readSetupContinuation(rawReturnTo) : undefined;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [persistent, setPersistent] = useState(true);
  const spaces = useQuery({
    queryKey: ["browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
    staleTime: 10_000,
  });
  const create = useMutation({
    mutationFn: () =>
      browserSpacesService.createSpace({
        name,
        startUrl,
        profileRetention: persistent ? "retain" : "ephemeral",
      }),
    onSuccess: async (space) => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      setOpen(false);
      if (continuation) {
        await navigate({
          to: "/tests/new",
          search: {
            ...(continuation.appId ? { app: continuation.appId } : {}),
            target: space.id,
          },
        });
      } else {
        await navigate({ to: "/environments/$profileId", params: { profileId: space.id } });
      }
    },
  });

  function reset() {
    setName("");
    setStartUrl("");
    setPersistent(true);
    create.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 max-w-[1080px]">
      <Breadcrumbs items={[{ label: "Home", to: "/home" }, { label: "Environments" }]} />
      <header className="relay-page-header flex items-start justify-between gap-4 max-[780px]:flex-col">
        <div>
          <p className="relay-eyebrow mb-2 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-weak)]">
            Workspace
          </p>
          <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
            Environments
          </h1>
          <p className="relay-page-description mt-2.5 max-w-[62ch] text-[15px] leading-[1.55] text-[var(--text-weak)]">
            Reuse isolated browser Spaces, inspect readiness, and keep reviewed sign-ins on the
            Relay host.
          </p>
        </div>
        <div className="flex flex-none flex-wrap gap-4">
          {continuation ? (
            <Button
              variant="ghost"
              nativeButton={false}
              render={
                <Link
                  to="/tests/new"
                  search={{
                    ...(continuation.appId ? { app: continuation.appId } : {}),
                    ...(continuation.targetId ? { target: continuation.targetId } : {}),
                  }}
                />
              }
            >
              Back to Test setup
            </Button>
          ) : null}
          <Button nativeButton={false} render={<Link to="/devices" />} variant="outline">
            Devices
          </Button>
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (next) reset();
            }}
          >
            <DialogTrigger render={<Button variant="default" />}>
              <Plus aria-hidden="true" /> New Browser Space
            </DialogTrigger>

            <DialogContent showCloseButton={false} className="relay-environment-dialog">
              <DialogTitle>New Browser Space</DialogTitle>
              <DialogDescription>
                Relay keeps each managed browser isolated. Persistent Spaces retain their local
                profile between Sessions.
              </DialogDescription>
              <form onSubmit={submit}>
                <Field>
                  <FieldLabel htmlFor="space-name">Name</FieldLabel>
                  <Input
                    id="space-name"
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    placeholder="For example, Staging member"
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="space-url">Start URL</FieldLabel>
                  <Input
                    id="space-url"
                    type="url"
                    inputMode="url"
                    value={startUrl}
                    onChange={(event) => setStartUrl(event.currentTarget.value)}
                    placeholder="https://staging.example.com"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </Field>
                <ChoiceLabel className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      Keep this browser profile
                    </span>
                    <span className="text-xs leading-snug text-muted-foreground">
                      Retain local storage and reviewed account fixtures between Sessions.
                    </span>
                  </span>
                  <Checkbox
                    checked={persistent}
                    onCheckedChange={(checked) => setPersistent(checked === true)}
                  />
                </ChoiceLabel>
                {create.error ? (
                  <FieldError>
                    {create.error instanceof Error
                      ? create.error.message
                      : "Relay could not create this Browser Space."}
                  </FieldError>
                ) : null}
                <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
                  <DialogClose
                    render={
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (continuation) {
                            void navigate({
                              to: "/tests/new",
                              search: {
                                ...(continuation.appId ? { app: continuation.appId } : {}),
                                ...(continuation.targetId ? { target: continuation.targetId } : {}),
                              },
                            });
                          }
                        }}
                      />
                    }
                  >
                    Cancel
                  </DialogClose>
                  <Button
                    type="submit"
                    variant="default"
                    disabled={!name.trim() || !startUrl.trim() || create.isPending}
                  >
                    {create.isPending ? "Creating…" : "Create Space"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {spaces.isPending ? <PageLoading label="Loading Environments…" /> : null}
      {spaces.error ? (
        <RecoveryState
          layout="centered"
          title="Environments are unavailable"
          detail="Reconnect Relay, then load managed browser Spaces again."
          action={
            <Button variant="outline" onClick={() => void spaces.refetch()}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      ) : null}
      {spaces.data?.length ? (
        <ul className="grid list-none gap-2.5 p-0" aria-label="Browser Spaces">
          {spaces.data.map((space) => (
            <li key={space.id}>
              <Link
                to="/environments/$profileId"
                params={{ profileId: space.id }}
                search={continuation ? { returnTo: rawReturnTo } : undefined}
              >
                <span
                  className="grid size-[38px] place-items-center rounded-md border border-border bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <Globe2 />
                </span>
                <span>
                  <strong>{space.name}</strong>
                  <small>{displayHost(space.startUrl)}</small>
                  <small>
                    {space.persistent ? "Persistent profile" : "Ephemeral profile"}
                    {space.environment?.locale ? ` · ${space.environment.locale}` : ""}
                  </small>
                </span>
                <span className="inline-flex flex-none items-center gap-1.5 text-xs font-semibold text-primary">
                  Open <span aria-hidden="true">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {!spaces.isPending && !spaces.error && spaces.data?.length === 0 ? (
        <EmptyState
          icon={Globe2}
          title="No browser Spaces yet"
          detail="Create one reusable, isolated browser environment for recording and running Tests."
          action={
            <Button
              variant="default"
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              New Browser Space
            </Button>
          }
        />
      ) : null}
      <section className="min-w-0 rounded-xl border border-border bg-card p-[18px] shadow-sm">
        <div>
          <h2>Physical devices stay live</h2>
          <p>
            Connected iOS and Android devices are managed separately because their readiness changes
            with cables, locks, and local tooling.
          </p>
        </div>
        <Link
          className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
          to="/devices"
        >
          View Devices
        </Link>
      </section>
    </section>
  );
}
