import { describe, expect, it } from "vitest";
import { recentWebsites, websiteAddress } from "./new-test-quick-start";

describe("websiteAddress", () => {
  it("accepts bare hosts and full URLs, rejects non-web input", () => {
    expect(websiteAddress("grok.com")).toBe("https://grok.com/");
    expect(websiteAddress(" https://staging.example.com/login ")).toBe(
      "https://staging.example.com/login",
    );
    expect(websiteAddress("localhost:3000")).toBe("http://localhost:3000/");
    expect(websiteAddress("127.0.0.1:8793")).toBe("http://127.0.0.1:8793/");
    expect(websiteAddress("[::1]:8793")).toBe("http://[::1]:8793/");
    expect(websiteAddress("https://localhost:3000")).toBe("https://localhost:3000/");
    expect(websiteAddress("127.example.com")).toBe("https://127.example.com/");
    expect(websiteAddress("hello")).toBe("");
    expect(websiteAddress("ftp://example.com")).toBe("");
    expect(websiteAddress("ftp://localhost:3000")).toBe("");
    expect(websiteAddress("file://localhost/private.txt")).toBe("");
  });
});

describe("recentWebsites", () => {
  const space = (startUrl: string, updatedAt: number) =>
    ({ startUrl, updatedAt }) as Parameters<typeof recentWebsites>[0][number];
  it("keeps one entry per host, newest first, and skips local addresses", () => {
    expect(
      recentWebsites([
        space("https://grok.com/", 1),
        space("https://grok.com/plans", 3),
        space("http://127.0.0.1:8791/", 4),
        space("https://chatgpt.com/", 2),
      ]),
    ).toEqual(["https://grok.com/plans", "https://chatgpt.com/"]);
  });
});
