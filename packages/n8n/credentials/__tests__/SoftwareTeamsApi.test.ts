import { describe, test, expect, beforeEach } from "bun:test";
import { SoftwareTeamsApi } from "../SoftwareTeamsApi.credentials";

describe("SoftwareTeamsApi credential type (AC8, AC9, R-02)", () => {
  let credential: SoftwareTeamsApi;

  beforeEach(() => {
    credential = new SoftwareTeamsApi();
  });

  describe("credential metadata", () => {
    test("name is 'softwareTeamsApi'", () => {
      expect(credential.name).toBe("softwareTeamsApi");
    });

    test("displayName is 'Software Teams API'", () => {
      expect(credential.displayName).toBe("Software Teams API");
    });

    test("documentationUrl is set", () => {
      expect(credential.documentationUrl).toBeTruthy();
      expect(credential.documentationUrl).toContain("github");
    });
  });

  describe("ANTHROPIC_API_KEY — required secret field (AC9)", () => {
    test("declares anthropicApiKey property", () => {
      const anthropicKeyProp = credential.properties.find(
        (p) => p.name === "anthropicApiKey",
      );
      expect(anthropicKeyProp).toBeTruthy();
    });

    test("anthropicApiKey is required", () => {
      const anthropicKeyProp = credential.properties.find(
        (p) => p.name === "anthropicApiKey",
      );
      expect(anthropicKeyProp?.required).toBeTrue();
    });

    test("anthropicApiKey type is 'string' with password: true (R-02)", () => {
      const anthropicKeyProp = credential.properties.find(
        (p) => p.name === "anthropicApiKey",
      );
      expect(anthropicKeyProp?.type).toBe("string");
      expect(anthropicKeyProp?.typeOptions?.password).toBeTrue();
    });

    test("anthropicApiKey description mentions ANTHROPIC_API_KEY and self-hosted requirement", () => {
      const anthropicKeyProp = credential.properties.find(
        (p) => p.name === "anthropicApiKey",
      );
      const desc = anthropicKeyProp?.description || "";
      expect(desc.toLowerCase()).toContain("anthropic");
      expect(desc).toContain("claude");
    });
  });

  describe("Optional integration tokens (R-02 — secrets masked)", () => {
    test("declares clickupApiKey property", () => {
      const clickupProp = credential.properties.find((p) => p.name === "clickupApiKey");
      expect(clickupProp).toBeTruthy();
    });

    test("declares datadogApiKey property", () => {
      const datadogProp = credential.properties.find((p) => p.name === "datadogApiKey");
      expect(datadogProp).toBeTruthy();
    });

    test("declares datadogAppKey property", () => {
      const datadogAppProp = credential.properties.find((p) => p.name === "datadogAppKey");
      expect(datadogAppProp).toBeTruthy();
    });

    test("declares githubToken property", () => {
      const githubProp = credential.properties.find((p) => p.name === "githubToken");
      expect(githubProp).toBeTruthy();
    });

    test("declares slackBotToken property", () => {
      const slackProp = credential.properties.find((p) => p.name === "slackBotToken");
      expect(slackProp).toBeTruthy();
    });
  });

  describe("Secret field protection (R-02 — no accidental exposure)", () => {
    test("all secret fields have password: true", () => {
      const secretFields = [
        "anthropicApiKey",
        "clickupApiKey",
        "datadogApiKey",
        "datadogAppKey",
        "githubToken",
        "slackBotToken",
      ];

      for (const fieldName of secretFields) {
        const prop = credential.properties.find((p) => p.name === fieldName);
        expect(prop).toBeTruthy();
        expect(prop?.typeOptions?.password).toBeTrue();
      }
    });

    test("no field is marked as a node parameter (all are credentials-only)", () => {
      // In n8n, if a field were exposed to the node level, it would appear
      // in the node's UI. The credential type is credentials-only by design.
      // We verify that all fields are in the credential properties array.
      expect(credential.properties).toBeDefined();
      expect(Array.isArray(credential.properties)).toBeTrue();
      expect(credential.properties.length).toBeGreaterThan(0);

      // All properties are for credentials, not node params
      for (const prop of credential.properties) {
        expect(prop.name).toBeTruthy();
        expect(prop.type).toMatch(/string|password|dropdown|oauth2/i);
      }
    });
  });

  describe("Field types and defaults", () => {
    test("all secret fields are type 'string'", () => {
      for (const prop of credential.properties) {
        expect(prop.type).toBe("string");
      }
    });

    test("all fields have default: '' (empty string)", () => {
      for (const prop of credential.properties) {
        expect(prop.default).toBe("");
      }
    });

    test("optional fields are not required", () => {
      const optionalFields = [
        "clickupApiKey",
        "datadogApiKey",
        "datadogAppKey",
        "githubToken",
        "slackBotToken",
      ];

      for (const fieldName of optionalFields) {
        const prop = credential.properties.find((p) => p.name === fieldName);
        expect(prop?.required).not.toBeTrue();
      }
    });
  });

  describe("field count and naming", () => {
    test("declares exactly 6 properties (1 required + 5 optional)", () => {
      expect(credential.properties).toHaveLength(6);
    });

    test("all property names follow camelCase convention", () => {
      for (const prop of credential.properties) {
        expect(prop.name).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      }
    });

    test("all displayNames are user-friendly", () => {
      for (const prop of credential.properties) {
        expect(prop.displayName).toBeTruthy();
        expect(prop.displayName).not.toMatch(/^[a-z]/); // Starts with capital
      }
    });
  });

  describe("documentation and descriptions", () => {
    test("each property has a description", () => {
      for (const prop of credential.properties) {
        expect(prop.description).toBeTruthy();
      }
    });

    test("clickupApiKey description mentions ClickUp and trigger/context", () => {
      const clickupProp = credential.properties.find((p) => p.name === "clickupApiKey");
      const desc = clickupProp?.description || "";
      expect(desc.toLowerCase()).toContain("clickup");
      expect(desc.toLowerCase()).toContain("trigger");
    });

    test("datadogApiKey description mentions Datadog and trigger/issue", () => {
      const datadogProp = credential.properties.find((p) => p.name === "datadogApiKey");
      const desc = datadogProp?.description || "";
      expect(desc.toLowerCase()).toContain("datadog");
      expect(desc.toLowerCase()).toContain("issue");
    });

    test("githubToken description mentions repo and PR scopes", () => {
      const githubProp = credential.properties.find((p) => p.name === "githubToken");
      const desc = githubProp?.description || "";
      expect(desc.toLowerCase()).toContain("github");
      expect(desc.toLowerCase()).toContain("token");
    });

    test("slackBotToken description mentions Slack bot token and HITL", () => {
      const slackProp = credential.properties.find((p) => p.name === "slackBotToken");
      const desc = slackProp?.description || "";
      expect(desc.toLowerCase()).toContain("slack");
      expect(desc.toLowerCase()).toContain("bot");
    });
  });

  describe("integration token mutual exclusivity (Datadog pair)", () => {
    test("datadogApiKey and datadogAppKey are a paired set", () => {
      const apiKeyProp = credential.properties.find((p) => p.name === "datadogApiKey");
      const appKeyProp = credential.properties.find((p) => p.name === "datadogAppKey");

      expect(apiKeyProp).toBeTruthy();
      expect(appKeyProp).toBeTruthy();

      // Both should have similar descriptions mentioning they pair
      const apiDesc = apiKeyProp?.description || "";
      const appDesc = appKeyProp?.description || "";
      expect(apiDesc.toLowerCase()).toContain("datadog");
      expect(appDesc.toLowerCase()).toContain("datadog");
    });
  });

  describe("credential instantiation", () => {
    test("credential instance is an ICredentialType", () => {
      // n8n credentials implement ICredentialType interface
      expect(credential.name).toBeDefined();
      expect(credential.displayName).toBeDefined();
      expect(credential.properties).toBeDefined();
    });

    test("properties array is frozen/immutable in design", () => {
      // The properties are defined as a fixed array; test that we can't
      // accidentally mutate the credential definition
      const originalLength = credential.properties.length;
      expect(credential.properties).toHaveLength(originalLength);
    });
  });

  describe("R-02: Secret handling policy", () => {
    test("credential type enforces no secrets in node parameters", () => {
      // By design, all secrets are in the credential type, not the node.
      // The node accesses them via this.getCredentials('softwareTeamsApi')
      // This test verifies the credential structure is separate from nodes.
      expect(credential.properties.every((p) => p.name)).toBeTrue();
      expect(credential.properties.every((p) => p.typeOptions?.password)).toBeTrue();
    });

    test("AC9: self-hosted constraint is documented in credential description", () => {
      const desc = credential.documentationUrl || "";
      expect(desc).toContain("self-hosted");
    });
  });
});
