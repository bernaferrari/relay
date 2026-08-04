import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@relay/client";
import { classifyError, ExitCode, UsageError } from "./errors.js";

test("errors map to stable exit codes", () => {
  assert.equal(classifyError(new UsageError("bad args")).exitCode, ExitCode.usage);
  assert.equal(classifyError(new TypeError("fetch failed")).exitCode, ExitCode.connection);
  assert.equal(classifyError(new ApiError(401, "unauthorized")).exitCode, ExitCode.auth);
  assert.equal(classifyError(new ApiError(422, "invalid")).exitCode, ExitCode.validation);
  assert.equal(classifyError(new ApiError(409, "stale")).exitCode, ExitCode.conflict);
  assert.equal(
    classifyError(new ApiError(403, "lease required", { code: "TARGET_CONTROL_LEASE_REQUIRED" }))
      .exitCode,
    ExitCode.conflict,
  );
  assert.equal(classifyError(new ApiError(500, "broken")).exitCode, ExitCode.server);
  assert.equal(
    classifyError(new DOMException("cancelled", "AbortError")).exitCode,
    ExitCode.cancellation,
  );
});
