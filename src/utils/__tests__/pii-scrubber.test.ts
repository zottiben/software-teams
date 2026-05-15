import { describe, test, expect } from "bun:test";
import { scrubPII, SCRUB_MARKERS } from "../pii-scrubber";

describe("scrubPII", () => {
  describe("PII patterns", () => {
    test("replaces email addresses with <email>", () => {
      expect(scrubPII("Customer john.doe+test@example.co.uk reports a bug")).toBe(
        "Customer <email> reports a bug",
      );
    });

    test("replaces multiple emails in one string", () => {
      expect(scrubPII("from alice@a.com to bob@b.org via cc@c.net")).toBe(
        "from <email> to <email> via <email>",
      );
    });

    test("replaces JWT tokens with <jwt>", () => {
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      expect(scrubPII(`Authorization: Bearer ${jwt}`)).toBe("Authorization: Bearer <jwt>");
    });

    test("replaces US SSN with <ssn>", () => {
      expect(scrubPII("SSN: 123-45-6789 on file")).toBe("SSN: <ssn> on file");
    });

    test("replaces credit cards with separators with <card>", () => {
      expect(scrubPII("Card 4111-1111-1111-1111 declined")).toBe("Card <card> declined");
      expect(scrubPII("Card 4111 1111 1111 1111 declined")).toBe("Card <card> declined");
    });

    test("replaces bare 16-digit card numbers with <card>", () => {
      expect(scrubPII("PAN 4111111111111111 ok")).toBe("PAN <card> ok");
    });

    test("replaces international phone numbers with <phone>", () => {
      expect(scrubPII("Call +1 555-123-4567 or +44 20 1234 5678")).toBe(
        "Call <phone> or <phone>",
      );
    });

    test("replaces US-formatted phone numbers with <phone>", () => {
      expect(scrubPII("Call 555-123-4567 today")).toBe("Call <phone> today");
      expect(scrubPII("Call (555) 123-4567")).toBe("Call <phone>");
    });

    test("replaces long token-like strings with <long-token>", () => {
      const token = "ghp_" + "a".repeat(60);
      expect(scrubPII(`token=${token}`)).toBe("token=<long-token>");
    });

    test("replaces 8+ digit numeric IDs with <id>", () => {
      expect(scrubPII("customer_id=12345678 ref=98765432101")).toBe(
        "customer_id=<id> ref=<id>",
      );
    });
  });

  describe("safe cases — must NOT scrub", () => {
    test("file paths with line numbers are preserved", () => {
      expect(scrubPII("at src/foo/bar.tsx:42:15")).toBe("at src/foo/bar.tsx:42:15");
    });

    test("short error codes are preserved", () => {
      expect(scrubPII("ERR_404 returned from /api")).toBe("ERR_404 returned from /api");
      expect(scrubPII("exit code 127")).toBe("exit code 127");
    });

    test("git commit SHAs (40-char hex) are preserved (NOT scrubbed as long-token — they are not user PII)", () => {
      // Adjustment from earlier draft: 40-char hashes are commit SHAs.
      // The long-token threshold is 60+ to avoid this false positive.
      expect(scrubPII("commit a1b2c3d4e5f6789012345678901234567890abcd landed")).toBe(
        "commit a1b2c3d4e5f6789012345678901234567890abcd landed",
      );
    });

    test("framework names and code identifiers are preserved", () => {
      expect(scrubPII("Error in NavigationProvider.tsx useNavigation hook")).toBe(
        "Error in NavigationProvider.tsx useNavigation hook",
      );
    });

    test("ISO timestamps are preserved", () => {
      expect(scrubPII("first_seen: 2026-05-15T03:26:48Z")).toBe(
        "first_seen: 2026-05-15T03:26:48Z",
      );
    });

    test("empty string passes through", () => {
      expect(scrubPII("")).toBe("");
    });
  });

  describe("composition", () => {
    test("scrubs mixed PII in a realistic error message", () => {
      const dirty =
        "ValidationError: invalid email for user_id=98765432, attempted alice@example.com (phone +1 555-123-4567, card 4111-1111-1111-1111)";
      const clean = scrubPII(dirty);
      // Every PII pattern replaced
      expect(clean).toContain("<id>");
      expect(clean).toContain("<email>");
      expect(clean).toContain("<phone>");
      expect(clean).toContain("<card>");
      // No raw values leak through — verify with the canonical pattern list.
      expect(clean).not.toMatch(/\b\d{8,}\b/); // no long numeric
      expect(clean).not.toMatch(/@example\.com/); // no email host
      expect(clean).not.toMatch(/4111[-\s]?1111/); // no card prefix
    });

    test("idempotent — scrubbing twice gives the same result", () => {
      const dirty = "user alice@bar.com from 192.168.0.1 ID 12345678";
      const once = scrubPII(dirty);
      const twice = scrubPII(once);
      expect(twice).toBe(once);
    });

    test("SCRUB_MARKERS lists every replacement token the module emits", () => {
      // Regression guard: tests + docs both index off this list. If a
      // new marker is added, it must be added here too.
      expect(SCRUB_MARKERS).toContain("<email>");
      expect(SCRUB_MARKERS).toContain("<phone>");
      expect(SCRUB_MARKERS).toContain("<card>");
      expect(SCRUB_MARKERS).toContain("<ssn>");
      expect(SCRUB_MARKERS).toContain("<jwt>");
      expect(SCRUB_MARKERS).toContain("<long-token>");
      expect(SCRUB_MARKERS).toContain("<id>");
    });
  });
});
