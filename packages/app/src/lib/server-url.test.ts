import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLocalBase } from "./api";

test("normalizes local localhost URLs to Relay's IPv4 loopback", () => {
  assert.equal(normalizeLocalBase("http://localhost:8787/"), "http://127.0.0.1:8787");
  assert.equal(normalizeLocalBase(" http://localhost:8787/// "), "http://127.0.0.1:8787");
});

test("does not rewrite remote or HTTPS URLs", () => {
  assert.equal(normalizeLocalBase("https://localhost:8787/"), "https://localhost:8787");
  assert.equal(normalizeLocalBase("https://relay.example.com/"), "https://relay.example.com");
  assert.equal(normalizeLocalBase("http://192.168.1.20:8787/"), "http://192.168.1.20:8787");
});
