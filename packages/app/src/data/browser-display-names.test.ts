import { describe, expect, it } from "vitest";
import { browserDisplayNames } from "./browser-display-names";

function browser(id: string, name: string, startUrl: string, createdAt: number) {
  return { id, name, browser: { startUrl }, createdAt };
}

describe("browser choice identity", () => {
  it("shows the port for auto-named local websites and keeps named account profiles", () => {
    const names = browserDisplayNames([
      browser("local-a", "127.0.0.1", "http://127.0.0.1:8793/", 1),
      browser("local-b", "127.0.0.1", "http://127.0.0.1:8791/", 2),
      browser("member", "Checkout · Member", "https://shop.example/", 3),
    ]);
    expect([...names.values()]).toEqual(["127.0.0.1:8793", "127.0.0.1:8791", "Checkout · Member"]);
  });

  it("disambiguates same-site choices consistently across reordered reads and newly created browsers", () => {
    const old = [
      browser("z", "127.0.0.1", "http://127.0.0.1:8793/", 1),
      browser("a", "127.0.0.1", "http://127.0.0.1:8793/", 2),
    ];
    const first = browserDisplayNames(old);
    const next = browserDisplayNames([
      browser("b", "127.0.0.1", "http://127.0.0.1:8793/", 3),
      ...[...old].reverse(),
    ]);
    expect(first.get("z")).toBe("127.0.0.1:8793 · Browser 1");
    expect(next.get("z")).toBe(first.get("z"));
    expect(next.get("a")).toBe(first.get("a"));
    expect(next.get("b")).toBe("127.0.0.1:8793 · Browser 3");
  });
});
