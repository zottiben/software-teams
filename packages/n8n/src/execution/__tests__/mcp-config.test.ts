import { describe, test, expect } from "bun:test";
import { assertMcpToolRule, isMcpToolRule, mcpAllowRules, parseMcpConfig } from "../mcp-config";
import { resolveToolPolicy } from "../generic-turn";

const VALID = JSON.stringify({
  mcpServers: {
    clickup: { url: "https://mcp.clickup.com/mcp" },
    datadog: { command: "npx", args: ["-y", "datadog-mcp"] },
  },
});

describe("parseMcpConfig", () => {
  test("returns canonical JSON and the declared server names", () => {
    const config = parseMcpConfig(VALID);
    expect(config.servers).toEqual(["clickup", "datadog"]);
    expect(JSON.parse(config.json)).toEqual(JSON.parse(VALID));
  });

  test("tolerates surrounding whitespace from a pasted credential", () => {
    expect(parseMcpConfig(`\n  ${VALID}\n`).servers).toEqual(["clickup", "datadog"]);
  });

  test.each([
    ["an empty credential", "", /empty/i],
    ["malformed JSON", "{ nope", /valid JSON/i],
    ["a JSON array", "[]", /JSON object/i],
    ["a missing mcpServers key", '{"servers":{}}', /mcpServers/],
    ["an mcpServers array", '{"mcpServers":[]}', /mcpServers/],
    ["no servers at all", '{"mcpServers":{}}', /no servers/i],
  ])("rejects %s", (_label, raw, expected) => {
    expect(() => parseMcpConfig(raw)).toThrow(expected);
  });

  test("rejects a server name that would not survive a permission rule", () => {
    expect(() => parseMcpConfig('{"mcpServers":{"click up":{"url":"https://x"}}}')).toThrow(
      /Invalid MCP server name/,
    );
  });

  test("rejects an oversized configuration", () => {
    const huge = JSON.stringify({ mcpServers: { a: { url: "x".repeat(21_000) } } });
    expect(() => parseMcpConfig(huge)).toThrow(/20000 characters/);
  });
});

describe("mcpAllowRules", () => {
  test("allows every tool of each named server", () => {
    expect(mcpAllowRules(["clickup", "datadog"])).toEqual([
      "mcp__clickup__*",
      "mcp__datadog__*",
    ]);
  });

  test("is empty when nothing is configured", () => {
    expect(mcpAllowRules([])).toEqual([]);
  });
});

describe("MCP tool rules", () => {
  test("recognises MCP rules and leaves built-in tools alone", () => {
    expect(isMcpToolRule("mcp__clickup__search")).toBe(true);
    expect(isMcpToolRule("Read")).toBe(false);
    expect(isMcpToolRule("Bash(git:*)")).toBe(false);
  });

  test.each(["mcp__clickup", "mcp__clickup__search", "mcp__click-up__*"])(
    "accepts %s",
    (rule) => {
      expect(() => assertMcpToolRule(rule)).not.toThrow();
    },
  );

  test.each(["mcp__", "mcp__click up__search", "mcp__clickup__search()"])(
    "rejects %s",
    (rule) => {
      expect(() => assertMcpToolRule(rule)).toThrow(/Invalid MCP tool rule/);
    },
  );
});

describe("resolveToolPolicy with MCP tools", () => {
  test("accepts MCP rules alongside built-in tools in custom mode", () => {
    expect(resolveToolPolicy("custom", "Read\nGrep\nmcp__clickup__clickup_search")).toEqual([
      "Read",
      "Grep",
      "mcp__clickup__clickup_search",
    ]);
  });

  test("still rejects an unknown built-in tool", () => {
    expect(() => resolveToolPolicy("custom", "Read\nTeleport")).toThrow(/Unknown Claude Code tool/);
  });

  test("rejects a malformed MCP rule rather than passing it to the CLI", () => {
    expect(() => resolveToolPolicy("custom", "Read\nmcp__bad name__x")).toThrow(
      /Invalid MCP tool rule/,
    );
  });

  test("leaves the fixed policies free of MCP entries", () => {
    expect(resolveToolPolicy("readOnly", "")).toEqual(["Read", "Glob", "Grep"]);
  });
});
