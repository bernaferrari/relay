import { closeBrowserDeviceSession, shutdownSessionExecution } from "@relay/core";

/** Drains durable work before closing process-owned interactive browser state. */
export async function shutdownServerSessions(timeoutMs: number): Promise<void> {
  await shutdownSessionExecution(timeoutMs);
  await closeBrowserDeviceSession();
}
