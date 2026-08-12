import { describe, expect, test } from "bun:test";
import { SoftwareTeamsClickUpApi } from "../SoftwareTeamsClickUpApi.credentials";

describe("SoftwareTeamsClickUpApi credential", () => {
  const credential = new SoftwareTeamsClickUpApi();

  test("stores only the token as a password field", () => {
    const token = credential.properties.find((property) => property.name === "apiToken");
    expect(token?.type).toBe("string");
    expect(token?.typeOptions?.password).toBeTrue();
    expect(token?.required).toBeTrue();
  });

  test("uses a configurable API base for test proxies without putting credentials in the URL", () => {
    const base = credential.properties.find((property) => property.name === "apiBase");
    expect(base?.default).toBe("https://api.clickup.com");
    expect(base?.typeOptions?.password).toBeFalsy();
  });

  test("authenticates requests with ClickUp's Authorization header", () => {
    expect(credential.authenticate).toEqual({
      type: "generic",
      properties: {
        headers: { Authorization: "={{$credentials.apiToken}}" },
      },
    });
  });

  test("tests the credential against the current user endpoint", () => {
    expect(credential.test).toEqual({
      request: {
        baseURL: "={{$credentials.apiBase}}",
        url: "/api/v2/user",
      },
    });
  });
});
