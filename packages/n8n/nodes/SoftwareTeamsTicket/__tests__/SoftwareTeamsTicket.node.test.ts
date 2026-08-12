import { describe, expect, test } from "bun:test";
import { SoftwareTeamsTicket } from "../SoftwareTeamsTicket.node";

describe("SoftwareTeamsTicket node", () => {
  const node = new SoftwareTeamsTicket();

  test("is an input-to-envelope transform rather than a trigger", () => {
    expect(node.description.name).toBe("softwareTeamsTicket");
    expect(node.description.inputs).toEqual(["main"]);
    expect(node.description.outputs).toEqual(["main"]);
    expect(node.description.usableAsTool).toBeUndefined();
  });

  test("manual JSON is the default and needs no credential", () => {
    const source = node.description.properties.find((property) => property.name === "source");
    expect(source?.default).toBe("manual");
    const values = Array.isArray(source?.options)
      ? source.options.map((option) => ("value" in option ? option.value : undefined))
      : [];
    expect(values).toEqual(["clickup", "manual"]);

    const credential = node.description.credentials?.find(
      (entry) => entry.name === "softwareTeamsClickUpApi",
    );
    expect(credential?.required).toBeFalse();
    expect(credential?.displayOptions?.show?.source).toEqual(["clickup"]);
  });

  test("accepts pasted or expression-supplied JSON and a ClickUp URL through one boundary", () => {
    const ticketJson = node.description.properties.find(
      (property) => property.name === "ticketJson",
    );
    const clickupRef = node.description.properties.find(
      (property) => property.name === "clickupRef",
    );
    expect(ticketJson?.displayOptions?.show?.source).toEqual(["manual"]);
    expect(clickupRef?.displayOptions?.show?.source).toEqual(["clickup"]);
  });

  test("starts with the support triage specialist and a cumulative budget", () => {
    expect(
      node.description.properties.find((property) => property.name === "agentId")?.default,
    ).toBe("software-teams-support-triage");
    const budget = node.description.properties.find(
      (property) => property.name === "ticketBudgetUsd",
    );
    expect(budget?.default).toBe(1);
    expect(budget?.typeOptions?.minValue).toBeGreaterThan(0);
  });
});
