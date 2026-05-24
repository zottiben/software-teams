/**
 * Unit tests for the redaction utility (src/utils/redact.ts).
 */

import { describe, expect, it } from "bun:test";
import { redact } from "../utils/redact.ts";

describe("redact — API key patterns", () => {
  it("redacts api_key=<token> form", () => {
    const input = "Sending request with api_key=sk-abc123xyz";
    expect(redact(input)).not.toContain("sk-abc123xyz");
    expect(redact(input)).toContain("***REDACTED***");
  });

  it("redacts api-key: <token> form", () => {
    const input = "Header: api-key: supersecrettoken";
    expect(redact(input)).not.toContain("supersecrettoken");
    expect(redact(input)).toContain("***REDACTED***");
  });

  it("redacts apikey=<token> (no separator) form", () => {
    const input = "config apikey=myapikey123";
    expect(redact(input)).not.toContain("myapikey123");
    expect(redact(input)).toContain("***REDACTED***");
  });

  it("is case-insensitive for API_KEY", () => {
    const input = "API_KEY=MYSECRET";
    expect(redact(input)).not.toContain("MYSECRET");
    expect(redact(input)).toContain("***REDACTED***");
  });
});

describe("redact — Bearer token patterns", () => {
  it("redacts Bearer <token> in Authorization header", () => {
    const input = "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig";
    const result = redact(input);
    expect(result).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    expect(result).toContain("Bearer ***REDACTED***");
  });

  it("redacts Bearer token mid-string", () => {
    const input = "sending with Bearer abc123def456 to endpoint";
    expect(redact(input)).not.toContain("abc123def456");
  });
});

describe("redact — provider key prefix patterns", () => {
  it("redacts sk- prefixed keys (Anthropic/OpenAI style)", () => {
    const input = "Using key sk-abcdefghijklmnop for requests";
    expect(redact(input)).not.toContain("sk-abcdefghijklmnop");
    expect(redact(input)).toContain("***REDACTED***");
  });

  it("redacts xai- prefixed keys", () => {
    const input = "xAI key: xai-SomeKey1234567890abcdef";
    expect(redact(input)).not.toContain("xai-SomeKey1234567890abcdef");
    expect(redact(input)).toContain("***REDACTED***");
  });

  it("redacts moon- prefixed keys", () => {
    const input = "Moonshot key: moon-abcdef1234567890xyz";
    expect(redact(input)).not.toContain("moon-abcdef1234567890xyz");
    expect(redact(input)).toContain("***REDACTED***");
  });

  it("does NOT redact short sk- values (under 16 chars)", () => {
    // "sk-short" is only 8 chars after the prefix — should not match
    const input = "sk-short is not a key";
    expect(redact(input)).toBe("sk-short is not a key");
  });
});

describe("redact — preserves non-secret content", () => {
  it("does not alter plain text with no secrets", () => {
    const input = "This is a regular log message with no secrets.";
    expect(redact(input)).toBe(input);
  });

  it("preserves text around redacted portions", () => {
    const input = "Start Bearer secrettoken123456789 end";
    const result = redact(input);
    expect(result).toContain("Start");
    expect(result).toContain("end");
  });

  it("is safe on empty string", () => {
    expect(redact("")).toBe("");
  });
});

describe("redact — idempotent", () => {
  it("redacting already-redacted output produces the same result", () => {
    const input = "api_key=mysecretvalue123456789";
    const once = redact(input);
    const twice = redact(once);
    expect(once).toBe(twice);
  });
});
