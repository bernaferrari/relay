import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const SEEDED_MEMBER_SESSION_COOKIE = "relay_session";
export const SEEDED_MEMBER_SESSION_SECRET = "relay-seeded-member-fixture-secret";
export const SEEDED_MEMBER_EXPECTED_SEATS = 4;
export const SEEDED_MEMBER_DEFECT_SEATS = 5;
export const SEEDED_MEMBER_ADMIN_SEATS = 99;
export const SEEDED_MEMBER_ROLES = ["admin", "member"] as const;

export type SeededMemberRole = (typeof SEEDED_MEMBER_ROLES)[number];
export type SeededMemberVisibleRole = SeededMemberRole | "signed-out";
export type SeededMemberLocale = "en" | "ar";

export type SeededMemberSession = {
  role: SeededMemberRole;
  issuedAt: number;
};

export type SeededMemberApp = {
  handler: http.RequestListener;
  setDefect(on: boolean): void;
  defectOn(): boolean;
  mintSession(role: SeededMemberRole, issuedAt?: number): string;
  verifySession(token: string | undefined): SeededMemberSession | undefined;
};

const ROLE_SET = new Set<string>(SEEDED_MEMBER_ROLES);

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function equalHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function mintSeededMemberSession(
  role: SeededMemberRole,
  secret = SEEDED_MEMBER_SESSION_SECRET,
  issuedAt = Date.now(),
): string {
  const body = `v1.${role}.${issuedAt}`;
  return `${body}.${hmac(body, secret)}`;
}

export function verifySeededMemberSession(
  token: string | undefined,
  secret = SEEDED_MEMBER_SESSION_SECRET,
): SeededMemberSession | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return undefined;
  const role = parts[1];
  const issuedAt = Number(parts[2]);
  const digest = parts[3];
  if (!role || !ROLE_SET.has(role) || !Number.isSafeInteger(issuedAt) || !digest) return undefined;
  const body = `v1.${role}.${issuedAt}`;
  if (!equalHex(hmac(body, secret), digest)) return undefined;
  return { role: role as SeededMemberRole, issuedAt };
}

export function readSeededMemberSessionCookie(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  const match = new RegExp(`(?:^|;\\s*)${SEEDED_MEMBER_SESSION_COOKIE}=([^;]+)`, "u").exec(
    cookieHeader,
  );
  return match?.[1];
}

function seatsFor(role: SeededMemberVisibleRole, defectOn: boolean): number | undefined {
  if (role === "signed-out") return undefined;
  if (role === "admin") return SEEDED_MEMBER_ADMIN_SEATS;
  return defectOn ? SEEDED_MEMBER_DEFECT_SEATS : SEEDED_MEMBER_EXPECTED_SEATS;
}

function htmlPage(
  title: string,
  body: string,
  options: { locale?: SeededMemberLocale; bodyClass?: string } = {},
): string {
  const locale = options.locale ?? "en";
  const bodyClass = options.bodyClass ? ` class="${options.bodyClass}"` : "";
  return `<!doctype html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head><meta charset="utf-8" /><title>${title}</title>
<style>
body{font:16px/1.4 sans-serif;margin:24px;position:relative}
a,button{display:inline-flex;align-items:center;min-width:44px;min-height:44px;padding:8px 12px}
#team-seats,#session-role,#open-settings,#manage-team,#manage-org,#save-settings{display:inline-flex;align-items:center;min-width:44px;min-height:44px}
.seats-row{display:inline-flex;align-items:center;position:relative;min-height:44px;flex-wrap:wrap}
.layout-defect #save-settings{position:absolute;inset-block-start:0;inset-inline-end:0;z-index:2}
.layout-defect #team-seats{position:relative;z-index:1}
</style>
</head>
<body${bodyClass}>
${body}
</body>
</html>
`;
}

export function seededMemberLocaleFromRequest(
  request: http.IncomingMessage,
  url: URL,
): SeededMemberLocale {
  const query = url.searchParams.get("lang")?.trim().toLowerCase();
  if (query === "ar" || query === "en") return query;
  const accept = request.headers["accept-language"] ?? "";
  const first = accept.split(",")[0]?.trim() ?? "";
  return /^ar(?:-|$)/iu.test(first) ? "ar" : "en";
}

export function renderSeededMemberHome(
  role: SeededMemberVisibleRole,
  locale: SeededMemberLocale = "en",
): string {
  if (role === "signed-out") {
    return htmlPage(
      locale === "ar" ? "تسجيل الدخول" : "Sign in",
      locale === "ar"
        ? `<h1>تسجيل الدخول</h1>
<p id="session-role">signed-out</p>
<p>جلسات المسؤول والعضو صادرة من الخادم. تسجيل الخروج ليس عضواً.</p>
<form method="POST" action="/session">
<button type="submit" name="role" value="member">متابعة كعضو</button>
<button type="submit" name="role" value="admin">متابعة كمسؤول</button>
</form>`
        : `<h1>Sign in</h1>
<p id="session-role">signed-out</p>
<p>Server-issued Admin and Member sessions are distinct. Signed-out is not Member.</p>
<form method="POST" action="/session">
<button type="submit" name="role" value="member">Continue as Member</button>
<button type="submit" name="role" value="admin">Continue as Admin</button>
</form>`,
      { locale },
    );
  }
  return htmlPage(
    locale === "ar" ? "الصفحة الرئيسية لمساحة العمل" : "Workspace home",
    locale === "ar"
      ? `<h1>الصفحة الرئيسية لمساحة العمل</h1>
<p>مسجّل الدخول كـ <span id="session-role">${role}</span></p>
<nav><a id="open-settings" href="/settings">الإعدادات</a></nav>`
      : `<h1>Workspace home</h1>
<p>Signed in as <span id="session-role">${role}</span></p>
<nav><a id="open-settings" href="/settings">Settings</a></nav>`,
    { locale },
  );
}

export function renderSeededMemberSettings(
  role: SeededMemberVisibleRole,
  defectOn: boolean,
  locale: SeededMemberLocale = "en",
): string {
  if (role === "signed-out") return renderSeededMemberHome("signed-out", locale);
  const seats = seatsFor(role, defectOn)!;
  const teamPermissions =
    role === "admin" || !defectOn
      ? `<a id="manage-team" href="/settings/team">${locale === "ar" ? "إدارة أذونات الفريق" : "Manage team permissions"}</a>`
      : "";
  const organization =
    role === "admin"
      ? `<a id="manage-org" href="/settings/org">${locale === "ar" ? "إدارة المؤسسة" : "Manage organization"}</a>`
      : "";
  const save = `<button type="button" id="save-settings">${locale === "ar" ? "حفظ" : "Save"}</button>`;
  return htmlPage(
    locale === "ar" ? "إعدادات مساحة العمل" : "Workspace settings",
    locale === "ar"
      ? `<h1>إعدادات مساحة العمل</h1>
<p>الحساب <span id="session-role">${role}</span></p>
<p class="seats-row"><span>المقاعد المتبقية للفريق</span>
<span id="team-seats" aria-label="المقاعد المتبقية للفريق">${seats}</span>${save}</p>
${teamPermissions}
${organization}
<a href="/">الرئيسية</a>`
      : `<h1>Workspace settings</h1>
<p>Account <span id="session-role">${role}</span></p>
<p class="seats-row"><span>Team seats remaining</span>
<span id="team-seats" aria-label="Team seats remaining">${seats}</span>${save}</p>
${teamPermissions}
${organization}
<a href="/">Home</a>`,
    { locale, ...(defectOn ? { bodyClass: "layout-defect" } : {}) },
  );
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function requestedRole(request: http.IncomingMessage, body: string): string | undefined {
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(body) as { role?: unknown };
      return typeof parsed.role === "string" ? parsed.role : undefined;
    } catch {
      return undefined;
    }
  }
  return new URLSearchParams(body).get("role") ?? undefined;
}

export function createSeededMemberApp(input?: {
  secret?: string;
  defect?: boolean;
}): SeededMemberApp {
  const secret = input?.secret ?? SEEDED_MEMBER_SESSION_SECRET;
  let defectOn = input?.defect ?? true;
  const sessionFrom = (request: http.IncomingMessage) =>
    verifySeededMemberSession(readSeededMemberSessionCookie(request.headers.cookie), secret);

  const handler: http.RequestListener = (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    void (async () => {
      if (request.method === "POST" && url.pathname === "/session") {
        const role = requestedRole(request, await readBody(request));
        if (!role || !ROLE_SET.has(role)) {
          response.statusCode = 400;
          response.setHeader("content-type", "text/plain");
          response.end("role must be admin or member");
          return;
        }
        const token = mintSeededMemberSession(role as SeededMemberRole, secret);
        response.statusCode = 303;
        response.setHeader(
          "set-cookie",
          `${SEEDED_MEMBER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
        );
        response.setHeader("location", "/");
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/control/defect") {
        const body = await readBody(request);
        const parsed = (() => {
          try {
            return JSON.parse(body) as { on?: unknown };
          } catch {
            return {};
          }
        })();
        defectOn = parsed.on !== false;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ on: defectOn }));
        return;
      }
      if (url.pathname === "/control/defect") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ on: defectOn }));
        return;
      }
      const session = sessionFrom(request);
      const role: SeededMemberVisibleRole = session?.role ?? "signed-out";
      const locale = seededMemberLocaleFromRequest(request, url);
      if (url.pathname === "/whoami") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ role, issuedAt: session?.issuedAt ?? null, locale }));
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (url.pathname === "/settings" || url.pathname.startsWith("/settings/")) {
        response.end(renderSeededMemberSettings(role, defectOn, locale));
        return;
      }
      response.end(renderSeededMemberHome(role, locale));
    })().catch(() => {
      if (!response.headersSent) response.statusCode = 500;
      response.end("fixture failed");
    });
  };

  return {
    handler,
    setDefect(on) {
      defectOn = on;
    },
    defectOn() {
      return defectOn;
    },
    mintSession(role, issuedAt) {
      return mintSeededMemberSession(role, secret, issuedAt);
    },
    verifySession(token) {
      return verifySeededMemberSession(token, secret);
    },
  };
}

export async function listenSeededMemberApp(input?: {
  port?: number;
  defect?: boolean;
  secret?: string;
}): Promise<{
  server: http.Server;
  port: number;
  url: string;
  app: SeededMemberApp;
}> {
  const app = createSeededMemberApp(input);
  const server = http.createServer(app.handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input?.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return { server, port: address.port, url: `http://127.0.0.1:${address.port}/`, app };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.SEEDED_MEMBER_PORT ?? "8791", 10);
  const defect = process.env.SEEDED_MEMBER_DEFECT !== "0";
  const { url } = await listenSeededMemberApp({ port, defect });
  process.stderr.write(`seeded-member app listening at ${url} defect=${defect}\n`);
}
