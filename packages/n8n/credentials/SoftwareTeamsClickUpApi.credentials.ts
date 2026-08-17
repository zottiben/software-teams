import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

/** Dedicated least-privilege credential for ticket ingestion and tag polling. */
export class SoftwareTeamsClickUpApi implements ICredentialType {
  name = "softwareTeamsClickUpApi";
  displayName = "Software Teams ClickUp API";
  icon = "file:softwareTeamsApi.svg" as const;
  documentationUrl = "https://developer.clickup.com/docs/authentication";

  properties: INodeProperties[] = [
    {
      displayName: "Personal API Token",
      name: "apiToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        "ClickUp personal API token used to read tickets, comments, and tagged-task lists. " +
        "Use a dedicated read-only integration identity where your ClickUp plan supports it.",
    },
    {
      displayName: "API Base URL",
      name: "apiBase",
      type: "string",
      default: "https://api.clickup.com",
      required: true,
      description:
        "ClickUp API origin. Keep the default in production; override only for an explicit test proxy.",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: { Authorization: "={{$credentials.apiToken}}" },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.apiBase}}",
      url: "/api/v2/user",
    },
  };
}
