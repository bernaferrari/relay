import {
  errorRecord,
  fail,
  fixtureFingerprint,
  GoldenAcceptanceError,
  isRecord,
} from "./golden-device-contract.mjs";
import { validateGoldenFaultReceipt } from "./golden-device-fault-contract.mjs";
import { captureGoldenFixtureEvidence } from "./golden-device-evidence.mjs";

export function assertGoldenFaultInjector(faults) {
  if (
    !isRecord(faults) ||
    typeof faults.disrupt !== "function" ||
    typeof faults.confirmRestored !== "function"
  ) {
    fail(
      "Strict golden acceptance requires a quarantined host fault injector with disrupt and confirmRestored operations.",
      "GOLDEN_FAULT_INJECTOR_MISSING",
    );
  }
}

async function boundedFaultOperation(action, label, options) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = options.setTimeout(() => {
          reject(
            new GoldenAcceptanceError(
              `${label} exceeded its ${options.faultTimeoutMs}ms host-side bound.`,
              "GOLDEN_FAULT_TIMEOUT",
            ),
          );
        }, options.faultTimeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) options.clearTimeout(timer);
  }
}

function assertRecoveryReady(recover, fixture, label) {
  if (
    !isRecord(recover) ||
    !isRecord(recover.recovery) ||
    recover.recovery.serial !== fixture.serial ||
    recover.recovery.ready !== true
  ) {
    fail(`${fixture.platform} ${label} did not report a ready target.`, "GOLDEN_RECOVERY_FAILED");
  }
}

async function requestFaultRecovery(api, writer, fixture, scenario, phase) {
  const recover = await api.request({
    operationId: "target.recover",
    method: "POST",
    path: "/device/recover",
    body: { serial: fixture.serial, reason: "control" },
  });
  await writer.json(
    `fixtures/${fixture.platform}/faults/${scenario}/${phase}-recovery.json`,
    recover,
  );
  assertRecoveryReady(recover, fixture, `${scenario} ${phase} recovery`);
  return recover;
}

/**
 * Bracket one host disruption with immutable evidence, Relay recovery, a
 * persisted public recipe proof, independent pixels/semantics, and an exact
 * host restoration receipt. The injected port can be faked offline while the
 * orchestration remains identical on the quarantined hardware host.
 */
export async function runGoldenFaultRecoveryScenario(input) {
  const { api, writer, fixture, scenario, options, runRecipe } = input;
  const invocationId = options.createFaultInvocationId();
  if (typeof invocationId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/u.test(invocationId)) {
    fail(
      "Golden host fault invocation ids must be non-empty safe identifiers.",
      "GOLDEN_FAULT_INVOCATION_INVALID",
    );
  }
  const faultInput = (phase) => {
    const startedAt = options.now();
    return {
      invocationId,
      scenario,
      phase,
      fixture,
      startedAt,
      deadlineAt: startedAt + options.faultTimeoutMs,
    };
  };
  let primaryError;
  let disruptionAttempted = false;
  let job;
  try {
    await captureGoldenFixtureEvidence(api, writer, fixture, `before-${scenario}`);
    const disruption = faultInput("disruption");
    disruptionAttempted = true;
    const receipt = await boundedFaultOperation(
      () => options.faults.disrupt(disruption),
      `${fixture.platform} ${scenario} disruption`,
      options,
    );
    validateGoldenFaultReceipt(receipt, disruption);
    await writer.json(
      `fixtures/${fixture.platform}/faults/${scenario}/disruption-receipt.json`,
      receipt,
    );
    await requestFaultRecovery(api, writer, fixture, scenario, "post-disruption");
    job = await runRecipe(api, writer, fixture, scenario, options);
    await captureGoldenFixtureEvidence(api, writer, fixture, `after-${scenario}`);
    await writer.json(`fixtures/${fixture.platform}/faults/${scenario}/post-fault-proof.json`, {
      schemaVersion: 1,
      invocationId,
      scenario,
      target: {
        platform: fixture.platform,
        serialFingerprint: fixtureFingerprint(fixture.serial),
      },
      job: { id: job.id, status: job.status, persisted: job.persisted },
      pixels: "captured",
      semantics: "captured",
    });
  } catch (error) {
    primaryError = error;
    await writer
      .json(
        `fixtures/${fixture.platform}/faults/${scenario}/scenario-error.json`,
        errorRecord(error),
      )
      .catch(() => undefined);
  }

  let restorationError;
  if (disruptionAttempted) {
    try {
      const recovery = await requestFaultRecovery(api, writer, fixture, scenario, "restoration");
      const restoration = faultInput("restoration");
      const receipt = await boundedFaultOperation(
        () => options.faults.confirmRestored({ ...restoration, recovery }),
        `${fixture.platform} ${scenario} restoration`,
        options,
      );
      validateGoldenFaultReceipt(receipt, restoration);
      await writer.json(
        `fixtures/${fixture.platform}/faults/${scenario}/restoration-receipt.json`,
        receipt,
      );
      await captureGoldenFixtureEvidence(api, writer, fixture, `restored-${scenario}`);
    } catch (error) {
      restorationError = error;
      await writer
        .json(
          `fixtures/${fixture.platform}/faults/${scenario}/restoration-error.json`,
          errorRecord(error),
        )
        .catch(() => undefined);
    }
  }
  if (restorationError) {
    if (primaryError) {
      throw new GoldenAcceptanceError(
        `${fixture.platform} ${scenario} failed and its fixture restoration was not proven.`,
        "GOLDEN_FAULT_RESTORATION_FAILED",
      );
    }
    throw restorationError;
  }
  if (primaryError) throw primaryError;
  return job;
}
