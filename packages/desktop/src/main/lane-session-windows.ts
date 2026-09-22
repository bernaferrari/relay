import { BrowserWindow, session } from "electron";
import {
  assertElectronGrokLabTabAllowed,
  electronGrokLabPartitionPresentOnDisk,
  laneHttpUrl,
  laneSessionPartition,
  laneTabSessionKey,
  laneWindowNeedsNavigation,
} from "./lane-session.js";

const laneWindows = new Map<string, BrowserWindow>();

export async function openLaneBrowserTab(input: { url: string; laneId: string }): Promise<{
  partition: string;
  tabSessionKey: string;
}> {
  const parsed = laneHttpUrl(input.url);
  assertElectronGrokLabTabAllowed({
    laneId: input.laneId,
    partitionPresent: electronGrokLabPartitionPresentOnDisk(),
  });
  const partition = laneSessionPartition(input.laneId);
  const tabSessionKey = laneTabSessionKey(input.laneId, parsed.host);
  const existing = laneWindows.get(partition);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    if (laneWindowNeedsNavigation(existing.webContents.getURL(), parsed.toString())) {
      await existing.loadURL(parsed.toString());
    }
    return { partition, tabSessionKey };
  }
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: true,
    webPreferences: {
      session: session.fromPartition(partition),
      sandbox: true,
      contextIsolation: true,
    },
  });
  win.on("closed", () => {
    if (laneWindows.get(partition) === win) laneWindows.delete(partition);
  });
  laneWindows.set(partition, win);
  await win.loadURL(parsed.toString());
  return { partition, tabSessionKey };
}

export async function setLaneSessionCookie(input: {
  laneId: string;
  url: string;
  name: string;
  value: string;
}): Promise<void> {
  assertElectronGrokLabTabAllowed({
    laneId: input.laneId,
    partitionPresent: electronGrokLabPartitionPresentOnDisk(),
  });
  const ses = session.fromPartition(laneSessionPartition(input.laneId));
  const url = laneHttpUrl(input.url).toString();
  await ses.cookies.set({
    url,
    name: input.name,
    value: input.value,
  });
}

export async function getLaneSessionCookies(input: {
  laneId: string;
  url: string;
}): Promise<Array<{ name: string; value: string }>> {
  assertElectronGrokLabTabAllowed({
    laneId: input.laneId,
    partitionPresent: electronGrokLabPartitionPresentOnDisk(),
  });
  const ses = session.fromPartition(laneSessionPartition(input.laneId));
  const cookies = await ses.cookies.get({ url: laneHttpUrl(input.url).toString() });
  return cookies.map((cookie) => ({ name: cookie.name, value: cookie.value }));
}
