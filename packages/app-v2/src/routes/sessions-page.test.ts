import { describe, expect, it } from "vitest";
import { sessionStateLabel, sessionWorkbenchMode } from "./sessions-page";

describe("session operating state", () => {
  it("keeps review and save distinct from a fresh live session", () => {
    expect(sessionWorkbenchMode("ready")).toBe("Live · Not recording");
    expect(sessionWorkbenchMode("recording")).toBe("Recording · captured actions are saved");
    expect(sessionWorkbenchMode("reviewing")).toBe("Reviewing · Not recording");
    expect(sessionWorkbenchMode("committing")).toBe("Saving · Not recording");
    expect(sessionStateLabel("committed")).toBe("Completed");
    expect(sessionWorkbenchMode("failed")).toBe("Needs attention");
    expect(sessionWorkbenchMode("committed")).toBe("Completed");
    expect(sessionWorkbenchMode("cancelled")).toBe("Ended");
    expect(sessionStateLabel("cancelled")).toBe("Ended");
  });
});
