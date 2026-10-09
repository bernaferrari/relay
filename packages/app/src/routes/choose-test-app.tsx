/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";

/** The same Test id exists in several apps; let the person pick instead of failing. */
export function ChooseTestApp({
  testId,
  owners,
}: {
  testId: string;
  owners: readonly { appMapId: string; appName: string }[];
}) {
  return (
    <section className="mx-4 my-3 max-w-2xl rounded-xl border border-border px-4 py-4 text-sm">
      <h2 className="font-medium text-foreground">Which app is this test in?</h2>
      <p className="mt-1 text-muted-foreground">
        More than one app has a test with this name. Choose the one you want to open.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {owners.map((owner) => (
          <li key={owner.appMapId}>
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={
                <Link to="/tests/$testId" params={{ testId }} search={{ app: owner.appMapId }} />
              }
            >
              {owner.appName}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
