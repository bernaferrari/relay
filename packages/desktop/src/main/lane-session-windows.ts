import { BrowserWindow, session } from "electron";
import { laneSessionPartition, laneTabSessionKey } from "./lane-session.js";

const laneWindows = new Map<string, BrowserWindow>();

export async function openLaneBrowserTab(input: { url: string; laneId: string }): Promise<{
  partition: string;
  tabSessionKey: string;
}> {
  const parsed = new URL(input.url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Lane tabs only open http(s) URLs");
  }
  const partition = laneSessionPartition(input.laneId);
  const tabSessionKey = laneTabSessionKey(input.laneId, parsed.host);
  const existing = laneWindows.get(partition);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
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
  const ses = session.fromPartition(laneSessionPartition(input.laneId));
  await ses.cookies.set({
    url: input.url,
    name: input.name,
    value: input.value,
  });
}

export async function getLaneSessionCookies(input: {
  laneId: string;
  url: string;
}): Promise<Array<{ name: string; value: string }>> {
  const ses = session.fromPartition(laneSessionPartition(input.laneId));
  const cookies = await ses.cookies.get({ url: input.url });
  return cookies.map((cookie) => ({ name: cookie.name, value: cookie.value }));
}
