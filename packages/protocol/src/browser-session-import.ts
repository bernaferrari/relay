import * as z from "zod/v4";

export const browserImportedStorageSchema = z
  .object({
    cookies: z
      .array(
        z
          .object({
            name: z.string().max(512),
            value: z.string().max(65536),
            domain: z.string().min(1).max(256),
            path: z.string().min(1).max(2048),
            expires: z.number().finite(),
            httpOnly: z.boolean(),
            secure: z.boolean(),
            sameSite: z.enum(["Strict", "Lax", "None"]),
            partitionKey: z.string().max(4096).optional(),
          })
          .strict(),
      )
      .max(10000),
    origins: z
      .array(
        z
          .object({
            origin: z.url(),
            localStorage: z
              .array(
                z.object({ name: z.string().max(65536), value: z.string().max(1048576) }).strict(),
              )
              .max(10000),
            indexedDB: z.array(z.unknown()).max(128).optional(),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((state, context) => {
    if (JSON.stringify(state).length > 8 * 1024 * 1024)
      context.addIssue({ code: "custom", message: "The sign-in file must be smaller than 8 MB." });
    if (state.origins.some((row) => !/^https?:\/\//u.test(row.origin)))
      context.addIssue({ code: "custom", message: "Sign-in origins must use HTTP or HTTPS." });
  });
export type BrowserImportedStorage = z.infer<typeof browserImportedStorageSchema>;

/** Accept browser cookie exports and Playwright state; discard exporter-specific fields. */
export function parseBrowserSessionImport(raw: string): BrowserImportedStorage {
  if (raw.length > 8 * 1024 * 1024) throw new Error("Choose a sign-in file smaller than 8 MB.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Choose a valid cookies or storage-state JSON file.");
  }
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (value as { cookies?: unknown }).cookies
      : undefined;
  if (!Array.isArray(rows)) throw new Error("This file does not contain browser cookies.");
  const cookies = rows.map((cookie: Record<string, unknown>) => {
    if (!cookie || typeof cookie !== "object")
      throw new Error("This file contains an invalid cookie.");
    const sameSite = String(cookie.sameSite ?? "Lax").toLowerCase();
    return {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path ?? "/",
      expires: cookie.expires ?? cookie.expirationDate ?? -1,
      httpOnly: cookie.httpOnly ?? false,
      secure: cookie.secure ?? false,
      sameSite:
        sameSite === "strict"
          ? "Strict"
          : sameSite === "none" || sameSite === "no_restriction"
            ? "None"
            : "Lax",
      ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
    };
  });
  const origins =
    !Array.isArray(value) && value && typeof value === "object"
      ? ((value as { origins?: unknown }).origins ?? [])
      : [];
  const parsed = browserImportedStorageSchema.safeParse({ cookies, origins });
  if (!parsed.success)
    throw new Error(
      "This file is not a supported browser cookie or Playwright storage-state export.",
    );
  if (!parsed.data.cookies.length && !parsed.data.origins.length)
    throw new Error("This file contains no cookies or saved sign-in state.");
  return parsed.data;
}
