import assert from "node:assert/strict";
import test from "node:test";
import { createRoot, createSignal } from "solid-js";
import type { DeviceLease, ServerConnection } from "@relay/protocol";
import { createServerTargetSessionController } from "./server-target-session-controller";

const connection: ServerConnection = {
  url: "http://127.0.0.1:8787",
  auth: { type: "none" },
  organizationId: "local",
  projectId: "default",
  actorId: "human:test",
  actorKind: "human",
};

function lease(id: string, deviceSerial: string, ownerId = "human:test"): DeviceLease {
  return {
    id,
    projectId: "default",
    poolId: "local",
    deviceSerial,
    ownerId,
    status: "leased",
    leasedAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

test("target switch clears stale evidence and atomically replaces its control lease", async () => {
  await new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      void (async () => {
        const [selectedDevice, setSelectedDevice] = createSignal<string | null>(null);
        const [error, setError] = createSignal<string | null>(null);
        let available = false;
        let leases: DeviceLease[] = [];
        const released: string[] = [];
        const created: string[] = [];
        const persisted: Array<string | null> = [];
        let resets = 0;
        const client = {
          async leases() {
            return { leases };
          },
          async lease(input: { deviceSerial: string }) {
            const next = lease(`lease-${input.deviceSerial}`, input.deviceSerial);
            leases = [...leases, next];
            created.push(next.id);
            return { lease: next };
          },
          async releaseLease(id: string) {
            released.push(id);
            const current = leases.find((candidate) => candidate.id === id)!;
            leases = leases.map((candidate) =>
              candidate.id === id ? { ...candidate, status: "released" as const } : candidate,
            );
            return { lease: { ...current, status: "released" as const } };
          },
          async takeOverLease() {
            throw new Error("not used");
          },
        };
        const controller = createServerTargetSessionController({
          client: () => client as never,
          connection: () => connection,
          devices: () => [
            { serial: "device-a", platform: "android", connectionState: "connected" },
            { serial: "device-b", platform: "ios", connectionState: "connected" },
          ],
          health: () => "online",
          selectedDevice,
          setSelectedDevice,
          selectedDeviceAvailable: () => available,
          setSelectedDeviceAvailable: (next) => {
            available = next;
          },
          persistSelectedDevice: (serial) => void persisted.push(serial),
          resetLivePreview: () => {
            resets += 1;
          },
          setError,
          now: () => 100,
        });

        await controller.selectDevice("device-a");
        assert.equal(controller.selectedLeaseId(), "lease-device-a");
        await controller.selectDevice("device-a");
        assert.deepEqual(created, ["lease-device-a"]);
        assert.deepEqual(released, []);

        await controller.selectDevice("device-b");
        assert.equal(controller.selectedLeaseId(), "lease-device-b");
        assert.deepEqual(created, ["lease-device-a", "lease-device-b"]);
        assert.deepEqual(released, ["lease-device-a"]);
        assert.deepEqual(persisted, ["device-a", "device-a", "device-b"]);
        assert.equal(resets, 2);
        assert.equal(error(), null);
      })()
        .then(() => {
          dispose();
          resolve();
        })
        .catch((error) => {
          dispose();
          reject(error);
        });
    });
  });
});

test("target session release is bounded and idempotent during provider cleanup", async () => {
  await new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      void (async () => {
        const [selectedDevice, setSelectedDevice] = createSignal<string | null>(null);
        const [, setError] = createSignal<string | null>(null);
        let available = false;
        let leases: DeviceLease[] = [];
        const released: string[] = [];
        const client = {
          async leases() {
            return { leases };
          },
          async lease(input: { deviceSerial: string }) {
            const next = lease("lease-cleanup", input.deviceSerial);
            leases = [next];
            return { lease: next };
          },
          async releaseLease(id: string) {
            released.push(id);
            return { lease: { ...leases[0]!, status: "released" as const } };
          },
          async takeOverLease() {
            throw new Error("not used");
          },
        };
        const controller = createServerTargetSessionController({
          client: () => client as never,
          connection: () => connection,
          devices: () => [
            { serial: "device-a", platform: "android", connectionState: "connected" },
          ],
          health: () => "online",
          selectedDevice,
          setSelectedDevice,
          selectedDeviceAvailable: () => available,
          setSelectedDeviceAvailable: (next) => {
            available = next;
          },
          persistSelectedDevice: () => undefined,
          resetLivePreview: () => undefined,
          setError,
          now: () => 100,
        });

        await controller.selectDevice("device-a");
        await controller.release();
        await controller.release();

        assert.equal(controller.selectedLeaseId(), null);
        assert.deepEqual(released, ["lease-cleanup"]);
      })()
        .then(() => {
          dispose();
          resolve();
        })
        .catch((error) => {
          dispose();
          reject(error);
        });
    });
  });
});
