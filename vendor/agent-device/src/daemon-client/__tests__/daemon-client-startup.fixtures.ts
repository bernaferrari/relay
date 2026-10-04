import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { runCmdDetachedMonitored } from '@agent-device/host-kit/command';
import { computeDaemonCodeSignature } from '@agent-device/host-kit/code-signature';
import { readProcessStartTime } from '@agent-device/host-kit/process';
import { findProjectRoot, readVersion } from '@agent-device/host-kit/version';
import { mkdtempForTestSync } from '../../__tests__/test-utils/tmp-dir.ts';
import type { DaemonPaths } from '../../daemon-resolution.ts';

const mockRunCmdDetached = vi.mocked(runCmdDetachedMonitored);

type DaemonInfoFixture = {
  port?: number;
  httpPort?: number;
  transport: 'socket' | 'http' | 'dual';
  token?: string;
  pid?: number;
  version?: string;
  codeSignature?: string;
  processStartTime?: string;
};

export function makeTempStateDir(prefix: string): string {
  return mkdtempForTestSync(prefix);
}

function resolveCurrentDaemonCodeSignature(): string {
  const root = findProjectRoot();
  const distPath = path.join(root, 'dist', 'src', 'internal', 'daemon.js');
  const sourcePath = path.join(root, 'src', 'daemon.ts');
  const entryPath =
    process.execArgv.includes('--experimental-strip-types') || !fs.existsSync(distPath)
      ? sourcePath
      : distPath;
  return computeDaemonCodeSignature(entryPath, root);
}

export function writeDaemonInfo(paths: DaemonPaths, info: DaemonInfoFixture): void {
  fs.mkdirSync(paths.baseDir, { recursive: true });
  fs.writeFileSync(
    paths.infoPath,
    `${JSON.stringify({
      token: info.token ?? 'local-secret',
      pid: info.pid ?? process.pid,
      version: info.version ?? readVersion(),
      codeSignature: info.codeSignature ?? resolveCurrentDaemonCodeSignature(),
      processStartTime: info.processStartTime ?? readProcessStartTime(process.pid) ?? undefined,
      port: info.port,
      httpPort: info.httpPort,
      transport: info.transport,
    })}\n`,
    'utf8',
  );
}

export function writeDaemonLock(
  paths: DaemonPaths,
  lock: { pid: number; processStartTime?: string; startedAt?: number },
): void {
  fs.mkdirSync(paths.baseDir, { recursive: true });
  fs.writeFileSync(
    paths.lockPath,
    `${JSON.stringify({ startedAt: Date.now(), ...lock })}\n`,
    'utf8',
  );
}

export function installSpawnedHttpDaemon(paths: DaemonPaths, httpPort: number): void {
  mockRunCmdDetached.mockImplementation((_command, _args, options) => {
    assert.equal(options?.env?.AGENT_DEVICE_STATE_DIR, paths.baseDir);
    writeDaemonInfo(paths, { httpPort, transport: 'http' });
    writeDaemonLock(paths, {
      pid: process.pid,
      processStartTime: readProcessStartTime(process.pid) ?? undefined,
    });
    return { pid: process.pid, exited: new Promise(() => {}) };
  });
}
