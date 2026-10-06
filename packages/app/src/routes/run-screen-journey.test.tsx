import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RunScreenJourney } from "./run-screen-journey";
import type { RunScreenJourney as Journey } from "../data/run-screen-journey";

it("marks the proven branch as Here without treating the expected destination as visited", () => {
  const journey: Journey = {
    planned: [
      { id: "home", screenId: "home", title: "Home", state: "visited", fact: "observed" },
      {
        id: "expected",
        screenId: "expected",
        title: "Settings",
        state: "pending",
        fact: "planned",
        via: { connectionId: "open", label: "Open settings" },
      },
    ],
    observed: [
      {
        screenId: "alternate",
        title: "Other Settings",
        at: 20,
        branch: true,
        fromScreenId: "home",
        fromWaypointId: "home",
      },
    ],
    current: {
      status: "proven",
      screenId: "alternate",
      title: "Other Settings",
      at: 30,
      fact: "observed",
    },
  };
  const element = document.createElement("div");
  element.innerHTML = renderToStaticMarkup(<RunScreenJourney journey={journey} />);
  expect(element.querySelector('[aria-current="location"]')?.textContent).toContain(
    "Other SettingsHere",
  );
  expect(element.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
  expect(element.textContent).toContain("Observed branch");
  element.innerHTML = renderToStaticMarkup(
    <RunScreenJourney journey={{ ...journey, current: { status: "unknown" } }} />,
  );
  expect(element.querySelector('[aria-current="location"]')).toBeNull();
  expect(element.textContent).not.toContain("Here");
  const cycle = {
    ...journey,
    planned: [
      ...journey.planned,
      {
        id: "return-home",
        screenId: "home",
        title: "Home",
        state: "pending" as const,
        fact: "planned" as const,
      },
    ],
  };
  element.innerHTML = renderToStaticMarkup(<RunScreenJourney journey={cycle} />);
  expect(element.textContent?.match(/Observed branch/g)).toHaveLength(1);
  expect(element.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
});
