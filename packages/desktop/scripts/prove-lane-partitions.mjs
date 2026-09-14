import { app, session } from "electron";

const url = "https://grok.com/";
const gmailPartition = "persist:lane:grok-auth-gmail";
const emailPartition = "persist:lane:grok-auth-email";

app.whenReady().then(async () => {
  const gmail = session.fromPartition(gmailPartition);
  const email = session.fromPartition(emailPartition);
  await gmail.cookies.set({ url, name: "relay-lane", value: "gmail" });
  const gmailCookies = await gmail.cookies.get({ url });
  const emailCookies = await email.cookies.get({ url });
  const present = gmailCookies.some((cookie) => cookie.name === "relay-lane" && cookie.value === "gmail");
  const leaked = emailCookies.some((cookie) => cookie.name === "relay-lane");
  const result = {
    ok: present && !leaked,
    gmailPartition,
    emailPartition,
    gmailHasCookie: present,
    emailHasCookie: leaked,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.exit(result.ok ? 0 : 1);
});
