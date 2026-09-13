import { describe, expect, it } from "vitest";
import {
  LOCAL_VITE_RELAY_PROXY,
  resolveWebServerUrl,
  sameOriginRelayProxyUrl,
} from "./web-platform";

describe("resolveWebServerUrl", () => {
  it("uses the same-origin Vite proxy in development instead of loopback :8787", () => {
    expect(
      resolveWebServerUrl({
        development: true,
        pageOrigin: "http://127.0.0.1:5175",
      }),
    ).toBe("http://127.0.0.1:5175/relay");
    expect(
      resolveWebServerUrl({
        development: true,
        stored: "http://127.0.0.1:8787",
        pageOrigin: "http://127.0.0.1:5175",
      }),
    ).toBe("http://127.0.0.1:5175/relay");
    expect(
      resolveWebServerUrl({
        development: true,
        configured: "http://localhost:8787/",
        pageOrigin: "http://127.0.0.1:5175",
      }),
    ).toBe("http://127.0.0.1:5175/relay");
  });

  it("keeps a remote or explicit non-8787 address", () => {
    expect(
      resolveWebServerUrl({
        development: true,
        stored: "https://relay.example.test",
        pageOrigin: "http://127.0.0.1:5175",
      }),
    ).toBe("https://relay.example.test");
  });

  it("falls back to :8787 outside Vite so desktop and curl stay unchanged", () => {
    expect(resolveWebServerUrl({ development: false })).toBe("http://127.0.0.1:8787");
    expect(
      resolveWebServerUrl({
        development: false,
        stored: "http://127.0.0.1:8787",
      }),
    ).toBe("http://127.0.0.1:8787");
  });

  it("names the proxy prefix when no page origin is available", () => {
    expect(sameOriginRelayProxyUrl()).toBe(LOCAL_VITE_RELAY_PROXY);
    expect(resolveWebServerUrl({ development: true })).toBe(LOCAL_VITE_RELAY_PROXY);
  });
});
