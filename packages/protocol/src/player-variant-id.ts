const CONFIG_KEY_ORDER = ["app", "account", "browser", "viewport", "locale", "build"] as const;

/** The player variant id for a declared configuration with no observed lane
 * or profile. Do not pass an account label or environment id here. */
export function playerVariantIdForConfiguration(
  configuration: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (!configuration) return undefined;
  const parts: string[] = [];
  for (const key of CONFIG_KEY_ORDER) {
    const value = configuration[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${key}=${formatVariantValue(value)}`);
  }
  for (const key of Object.keys(configuration).sort()) {
    if ((CONFIG_KEY_ORDER as readonly string[]).includes(key)) continue;
    const value = configuration[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${key}=${formatVariantValue(value)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatVariantValue(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
