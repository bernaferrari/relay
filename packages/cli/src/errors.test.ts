import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@relay/client";
import { classifyError, ExitCode, UsageError } from "./errors.js";

test("errors map to stable exit codes", () => {
  assert.equal(classifyError(new UsageError("bad args")).exitCode, ExitCode.usage);
  assert.equal(classifyError(new TypeError("fetch failed")).exitCode, ExitCode.connection);
  assert.match(
    classifyError(new TypeError("fetch failed")).message,
    /tsx watch may have restarted/u,
  );
  assert.match(
    classifyError(new TypeError("fetch failed")).message,
    /Do not recover-kill a live iOS runner/u,
  );
  assert.equal(classifyError(new ApiError(401, "unauthorized")).exitCode, ExitCode.auth);
  assert.equal(classifyError(new ApiError(422, "invalid")).exitCode, ExitCode.validation);
  assert.equal(classifyError(new ApiError(409, "stale")).exitCode, ExitCode.conflict);
  assert.equal(
    classifyError(new ApiError(403, "lease required", { code: "TARGET_CONTROL_LEASE_REQUIRED" }))
      .exitCode,
    ExitCode.conflict,
  );
  assert.equal(classifyError(new ApiError(500, "broken")).exitCode, ExitCode.server);
  assert.match(
    classifyError(new ApiError(500, "No active session. Run open first.")).message,
    /tunnel/i,
  );
  assert.doesNotMatch(
    classifyError(new ApiError(500, "No active session. Run open first.")).message,
    /Retry the tap/i,
  );
  assert.match(
    classifyError(new ApiError(500, "No active session. Run open first.")).message,
    /CoreDevice HID/,
  );
  assert.equal(
    classifyError(new DOMException("cancelled", "AbortError")).exitCode,
    ExitCode.cancellation,
  );
});

test("operation failure stays distinct from validation", () => {
  assert.equal(ExitCode.validation, 5);
  assert.equal(ExitCode.operationFailure, 9);
});
