import { createSignal, type Accessor, type Setter } from "solid-js";
import type { RelayClient } from "@relay/client";
import type { ServerConnection } from "@relay/protocol";
import type { DeviceInfo } from "./api-types";
import { findActiveConnectionLease } from "./device-control-session";
import { humanError } from "./human-error";
import { targetIsReady } from "./target-presentation";

type LeaseClient = Pick<RelayClient, "leases" | "lease" | "releaseLease" | "takeOverLease">;

export type ServerTargetSessionDependencies = {
  client: Accessor<LeaseClient | null>;
  connection: Accessor<ServerConnection | null>;
  devices: Accessor<DeviceInfo[]>;
  health: Accessor<"unknown" | "online" | "offline">;
  selectedDevice: Accessor<string | null>;
  setSelectedDevice: Setter<string | null>;
  selectedDeviceAvailable: Accessor<boolean>;
  setSelectedDeviceAvailable: (available: boolean) => void;
  persistSelectedDevice: (serial: string | null) => void;
  resetLivePreview: () => void;
  setError: Setter<string | null>;
  now?: () => number;
};

/**
 * Owns the exclusive-control lifecycle for the renderer's selected target.
 * Observation state lives elsewhere; callers only learn the small select,
 * validate, take-over, and release interface needed to control one target.
 */
export function createServerTargetSessionController(input: ServerTargetSessionDependencies) {
  const [selectedLeaseId, setSelectedLeaseId] = createSignal<string | null>(null);
  const [controlIssue, setControlIssue] = createSignal<string | null>(null);
  const [conflictingLeaseId, setConflictingLeaseId] = createSignal<string | null>(null);
  const [takingControl, setTakingControl] = createSignal(false);
  const now = input.now ?? Date.now;
  let validation: Promise<void> | null = null;

  const canTakeControl = () => Boolean(conflictingLeaseId());

  async function selectDevice(serial: string | null): Promise<void> {
    const previousSerial = input.selectedDevice();
    const targetChanged = serial !== previousSerial;
    if (targetChanged) input.resetLivePreview();

    input.setSelectedDevice(serial);
    const selectedTarget = input.devices().find((device) => device.serial === serial);
    input.setSelectedDeviceAvailable(targetIsReady(selectedTarget, input.health() === "online"));
    input.persistSelectedDevice(serial);

    const client = input.client();
    const connection = input.connection();
    if (!client || !connection) return;

    try {
      const currentLeaseId = selectedLeaseId();
      const leases = (await client.leases()).leases;
      const activeCurrentLease = currentLeaseId
        ? findActiveConnectionLease(connection, leases, (lease) => lease.id === currentLeaseId)
        : undefined;

      // Re-selection is the normal control validation path. Keep it idempotent
      // so an interaction cannot land between a release and a replacement.
      if (activeCurrentLease?.deviceSerial === serial) {
        setControlIssue(null);
        return;
      }

      if (activeCurrentLease && (targetChanged || activeCurrentLease.deviceSerial !== serial)) {
        await client.releaseLease(activeCurrentLease.id).catch(() => undefined);
      }
      setSelectedLeaseId(null);
      setControlIssue(null);
      setConflictingLeaseId(null);

      const claimableVirtualTarget = Boolean(
        serial && /simulator|emulator/i.test(selectedTarget?.kind ?? ""),
      );
      if (!serial || (!input.selectedDeviceAvailable() && !claimableVirtualTarget)) return;

      const active = findActiveConnectionLease(
        connection,
        leases,
        (lease) => lease.deviceSerial === serial,
      );
      const occupied = leases.find(
        (lease) =>
          lease.deviceSerial === serial && lease.status === "leased" && lease.expiresAt > now(),
      );
      if (!active && occupied) {
        setControlIssue("This device is reserved by another active controller.");
        setConflictingLeaseId(occupied.id);
        return;
      }

      const leaseId =
        active?.id ??
        (
          await client.lease({
            poolId: "local",
            deviceSerial: serial,
            // Interactions transparently revalidate this bounded lease.
            expiresAt: now() + 2 * 60 * 60 * 1000,
          })
        ).lease.id;
      setSelectedLeaseId(leaseId);
    } catch (error) {
      const message = humanError(error, "Could not reserve this device");
      setControlIssue(message);
      input.setError(message);
    }
  }

  async function validateSelectedControl(serial: string): Promise<void> {
    if (validation) return validation;
    const current = selectDevice(serial).finally(() => {
      if (validation === current) validation = null;
    });
    validation = current;
    return current;
  }

  async function takeControl(): Promise<boolean> {
    const client = input.client();
    const connection = input.connection();
    if (!client || !connection || takingControl()) return false;

    setTakingControl(true);
    const serial = input.selectedDevice();
    const leaseId = conflictingLeaseId();
    try {
      if (!serial || !leaseId) {
        await selectDevice(serial);
        return Boolean(selectedLeaseId());
      }
      const { lease } = await client.takeOverLease({
        leaseId,
        expiresAt: now() + 2 * 60 * 60 * 1000,
        reason: "Take control from the live device panel",
        confirm: true,
      });
      setSelectedLeaseId(lease.id);
      setConflictingLeaseId(null);
      setControlIssue(null);
      input.setError(null);
      return true;
    } catch (error) {
      const message = humanError(error, "Could not take control of this device");
      setControlIssue(message);
      input.setError(message);
      return false;
    } finally {
      setTakingControl(false);
    }
  }

  async function release(): Promise<void> {
    const client = input.client();
    const leaseId = selectedLeaseId();
    setSelectedLeaseId(null);
    if (client && leaseId) await client.releaseLease(leaseId).catch(() => undefined);
  }

  return {
    selectedLeaseId,
    controlIssue,
    canTakeControl,
    takingControl,
    setControlIssue,
    selectDevice,
    validateSelectedControl,
    takeControl,
    release,
  };
}
