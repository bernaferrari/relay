/** @jsxImportSource react */
import {
  Button,
  CheckboxCard,
  Dialog,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Globe2, Plus, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Breadcrumbs, EmptyState, RecoveryState } from "../components/product-patterns";
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
      await navigate({ to: "/environments/$profileId", params: { profileId: space.id } });
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
    <section className="relay-page relay-environments-page">
      <Breadcrumbs items={[{ label: "Home", to: "/home" }, { label: "Environments" }]} />
      <header className="relay-page-header relay-environments-header">
        <div>
          <p className="relay-eyebrow">Workspace</p>
          <h1>Environments</h1>
          <p className="relay-page-description">
            Reuse isolated browser Spaces, inspect readiness, and keep reviewed sign-ins on the
            Relay host.
          </p>
        </div>
        <div className="relay-environment-actions">
          <Button render={<Link to="/devices" />} variant="secondary">
            Devices
          </Button>
          <Dialog.Root
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (next) reset();
            }}
          >
            <Dialog.Trigger render={<Button variant="primary" />}>
              <Plus aria-hidden="true" /> New Browser Space
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="relay-dialog-backdrop" />
              <Dialog.Viewport className="relay-dialog-viewport">
                <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-environment-dialog">
                  <Dialog.Title>New Browser Space</Dialog.Title>
                  <Dialog.Description>
                    Relay keeps each managed browser isolated. Persistent Spaces retain their local
                    profile between Sessions.
                  </Dialog.Description>
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
                    <CheckboxCard
                      checked={persistent}
                      onCheckedChange={(checked) => setPersistent(checked === true)}
                      title="Keep this browser profile"
                      description="Retain local storage and reviewed account fixtures between Sessions."
                    />
                    {create.error ? (
                      <FieldError>
                        {create.error instanceof Error
                          ? create.error.message
                          : "Relay could not create this Browser Space."}
                      </FieldError>
                    ) : null}
                    <div className="relay-dialog-actions">
                      <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={!name.trim() || !startUrl.trim() || create.isPending}
                      >
                        {create.isPending ? "Creating…" : "Create Space"}
                      </Button>
                    </div>
                  </form>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </header>

      {spaces.isPending ? <PageLoading label="Loading Environments…" /> : null}
      {spaces.error ? (
        <RecoveryState
          layout="centered"
          title="Environments are unavailable"
          detail="Reconnect Relay, then load managed browser Spaces again."
          action={
            <Button variant="secondary" onClick={() => void spaces.refetch()}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      ) : null}
      {spaces.data?.length ? (
        <ul className="relay-environment-grid" aria-label="Browser Spaces">
          {spaces.data.map((space) => (
            <li key={space.id}>
              <Link to="/environments/$profileId" params={{ profileId: space.id }}>
                <span className="relay-environment-mark" aria-hidden="true">
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
                <span className="relay-app-list-action">
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
              variant="primary"
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
      <section className="relay-environment-device-note">
        <div>
          <h2>Physical devices stay live</h2>
          <p>
            Connected iOS and Android devices are managed separately because their readiness changes
            with cables, locks, and local tooling.
          </p>
        </div>
        <Link className="relay-inline-link" to="/devices">
          View Devices
        </Link>
      </section>
    </section>
  );
}
