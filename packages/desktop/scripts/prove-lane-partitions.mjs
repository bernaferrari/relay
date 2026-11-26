import { app, session } from "electron";

const url = "https://example.com/";
const laneAPartition = "persist:lane:proof-auth-a";
const laneBPartition = "persist:lane:proof-auth-b";

app.whenReady().then(async () => {
  const laneA = session.fromPartition(laneAPartition);
  const laneB = session.fromPartition(laneBPartition);
  await laneA.cookies.set({ url, name: "relay-lane", value: "lane-a" });
  const laneACookies = await laneA.cookies.get({ url });
  const laneBCookies = await laneB.cookies.get({ url });
  const present = laneACookies.some(
    (cookie) => cookie.name === "relay-lane" && cookie.value === "lane-a",
  );
  const leaked = laneBCookies.some((cookie) => cookie.name === "relay-lane");
  const result = {
    ok: present && !leaked,
    laneAPartition,
    laneBPartition,
    laneAHasCookie: present,
    laneBHasCookie: leaked,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.exit(result.ok ? 0 : 1);
});
