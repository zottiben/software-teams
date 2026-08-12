import type {
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IPollFunctions,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";
import { toDataObject } from "../../src/n8n-cast";
import {
  pollBufferLimit,
  selectPollCandidates,
  type ClickUpPollState,
} from "../../src/ingestion/clickup-poll";
import {
  ClickUpApiError,
  createClickUpFetchErrorEnvelope,
  createSupportEnvelope,
  fetchClickUpSupportTicket,
  listClickUpTaggedTasks,
  type ClickUpCredentials,
  type TaggedClickUpTask,
} from "../../src/ingestion/support-ticket";

// Deliberately not usable as an AI tool: invoking a poller outside n8n's
// activation lifecycle bypasses its first-run backlog boundary.
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class SoftwareTeamsClickUpTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Software Teams ClickUp Trigger",
    name: "softwareTeamsClickUpTrigger",
    icon: "file:softwareTeamsClickUpTrigger.svg",
    group: ["trigger"],
    version: 1,
    description:
      "Poll ClickUp for support tickets carrying a pickup tag and emit the same envelope as manual ticket intake.",
    subtitle: '={{ $parameter["pickupTag"] }}',
    defaults: { name: "Software Teams ClickUp Trigger" },
    polling: true,
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: "softwareTeamsClickUpApi", required: true }],
    properties: [
      {
        displayName: "Workspace ID",
        name: "workspaceId",
        type: "string",
        default: "",
        required: true,
        description:
          "Numeric ClickUp Workspace ID. In a URL such as /t/36826178/NDP-34603 this is 36826178.",
      },
      {
        displayName: "Pickup Tag",
        name: "pickupTag",
        type: "string",
        default: "software-teams",
        required: true,
        description:
          "Only tasks carrying this exact ClickUp tag start the workflow. Tag matching is performed by ClickUp's workspace task API.",
      },
      {
        displayName: "List IDs",
        name: "listIds",
        type: "string",
        default: "",
        description:
          "Optional comma-separated allowlist of ClickUp List IDs. Empty means any List the credential can read.",
      },
      {
        displayName: "Include Closed Tickets",
        name: "includeClosed",
        type: "boolean",
        default: false,
        description: "Whether a closed task carrying the pickup tag may start a run",
      },
      {
        displayName: "Process Existing Tagged Tickets on Activation",
        name: "processExisting",
        type: "boolean",
        default: false,
        description:
          "Whether first activation processes the current tagged backlog. Disabled by default so publishing a workflow cannot unexpectedly consume every old ticket.",
      },
      {
        displayName: "Max Tickets per Poll",
        name: "maxTickets",
        type: "number",
        default: 10,
        typeOptions: { minValue: 1, maxValue: 50 },
        description:
          "Maximum tickets emitted per poll. Timestamp-boundary IDs are retained so a cap cannot lose tickets updated in the same millisecond.",
      },
      {
        displayName: "Support Prompt",
        name: "prompt",
        type: "string",
        typeOptions: { rows: 4 },
        default: "Triage this support ticket. Classify it as a question, bug, change request, or escalation; identify the next safe action; and ask one specific question if information is missing.",
        required: true,
      },
      {
        displayName: "First Agent ID",
        name: "agentId",
        type: "string",
        default: "software-teams-support-triage",
        required: true,
      },
      {
        displayName: "Ticket Budget USD",
        name: "ticketBudgetUsd",
        type: "number",
        default: 1,
        typeOptions: { minValue: 0.01, numberPrecision: 2 },
        required: true,
        description: "Cumulative API-equivalent cost guardrail across the ticket's Claude turns",
      },
    ],
  };

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const isManual = this.getMode() === "manual";
    const state = this.getWorkflowStaticData("node") as ClickUpPollState;
    const processExisting = this.getNodeParameter("processExisting", false) as boolean;

    // Activation establishes "now" as the first boundary. This is the safe
    // default: applying a tag trigger must not silently drain a historic queue.
    if (!isManual && state.lastUpdatedMs === undefined && !processExisting) {
      const now = Date.now();
      state.lastUpdatedMs = now;
      state.boundaryTaskIds = [];
      state.observedUpdatedMs = now;
      state.observedBoundaryTaskIds = [];
      state.pendingTasks = [];
      return null;
    }

    const workspaceId = (this.getNodeParameter("workspaceId") as string).trim();
    const tag = (this.getNodeParameter("pickupTag") as string).trim();
    const listIds = splitListIds(this.getNodeParameter("listIds", "") as string);
    const includeClosed = this.getNodeParameter("includeClosed", false) as boolean;
    const maxTickets = this.getNodeParameter("maxTickets", 10) as number;
    const bufferLimit = pollBufferLimit(maxTickets);
    const prompt = this.getNodeParameter("prompt") as string;
    const agentId = this.getNodeParameter("agentId") as string;
    const budgetUsd = this.getNodeParameter("ticketBudgetUsd") as number;
    const credentials = await clickUpCredentials(this);

    const observedBoundary = state.observedUpdatedMs ?? state.lastUpdatedMs;
    const queryAfterMs = !isManual && observedBoundary !== undefined
      ? Math.max(0, observedBoundary - 1)
      : undefined;
    const availableSlots = Math.max(0, bufferLimit - (state.pendingTasks?.length ?? 0));
    const listed = !isManual && availableSlots === 0
      ? []
      : await listClickUpTaggedTasks(
          {
            workspaceId,
            tag,
            ...(queryAfterMs !== undefined ? { updatedAfterMs: queryAfterMs } : {}),
            ...(listIds.length > 0 ? { listIds } : {}),
            includeClosed,
            reverse: isManual,
            // Manual mode needs only the newest page. Production keeps at most
            // three batches in static data and leaves the remainder in ClickUp.
            // The helper validates ascending order, making the prefix safe.
            maxTasks: isManual ? 100 : availableSlots,
            ...(!isManual && state.observedBoundaryTaskIds?.length
              ? { excludeApiIds: state.observedBoundaryTaskIds }
              : {}),
          },
          credentials,
        );

    const selected = isManual
      ? {
          tasks: [...listed].sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, 1),
          nextState: state,
        }
      : selectPollCandidates(listed, state, maxTickets);
    if (selected.tasks.length === 0) {
      if (!isManual) persistPollState(state, selected.nextState);
      return null;
    }

    const output: INodeExecutionData[] = [];
    for (const task of selected.tasks) {
      try {
        const ticket = await fetchFullTicket(task, credentials);
        output.push({
          json: toDataObject(createSupportEnvelope(ticket, { prompt, agentId, budgetUsd })),
        });
      } catch (error) {
        // Quarantine one inaccessible/deleted/rate-limited ticket as an error
        // item so Human Review can recover it without wedging every later task.
        output.push({
          json: toDataObject(createClickUpFetchErrorEnvelope(task, {
            prompt,
            agentId,
            budgetUsd,
            message:
              error instanceof ClickUpApiError
                ? error.message
                : "ClickUp ticket request failed before context could be read",
          })),
        });
      }
    }

    if (!isManual) persistPollState(state, selected.nextState);
    return [output];
  }
}

async function clickUpCredentials(context: IPollFunctions): Promise<ClickUpCredentials> {
  const raw = await context.getCredentials("softwareTeamsClickUpApi");
  return {
    apiToken: typeof raw.apiToken === "string" ? raw.apiToken : "",
    apiBase: typeof raw.apiBase === "string" ? raw.apiBase : undefined,
  };
}

async function fetchFullTicket(
  task: TaggedClickUpTask,
  credentials: ClickUpCredentials,
) {
  // Use the opaque API ID returned by the list endpoint. It needs no custom-ID
  // query parameters and remains valid if the visible custom ID changes.
  return fetchClickUpSupportTicket({ taskId: task.apiId }, credentials);
}

function persistPollState(target: ClickUpPollState, source: ClickUpPollState): void {
  for (const key of [
    "lastUpdatedMs",
    "boundaryTaskIds",
    "pendingTasks",
    "observedUpdatedMs",
    "observedBoundaryTaskIds",
  ] as const) {
    const value = source[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete target[key];
    else target[key] = value as never;
  }
}

function splitListIds(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}
