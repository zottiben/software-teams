/**
 * conversation-state.ts multi-round + multi-channel tests (T2 — AC3, AC4, R-07).
 *
 * These are ADDITIONAL tests that verify the multi-round and multi-channel features
 * added in T2, complementing the existing conversation-state.test.ts.
 *
 * Verifies that:
 * - New channel field accepts all supported values (slack, email, notify, discord)
 * - New round field tracks conversation rounds correctly
 * - nextRound helper computes round numbers correctly (default 1 → 2, n → n+1)
 * - delivery bag persists channel-specific coordinates
 * - Old Slack-shaped states (no new fields) still load and round-trip unchanged
 * - Multi-round workflow: save → load → bump → re-save → load
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import {
  saveState,
  loadState,
  deleteState,
  nextRound,
  type ConversationState,
  type HitlChannel,
} from "../conversation-state";

const TEST_STORE_PATH = join(import.meta.dir, "__test_hitl_multiround.json");

function makeEnvelope(correlationId: string): NodeEnvelope {
  return {
    correlationId,
    agentId: "software-teams-hitl",
    status: "needs-input",
    input: { prompt: "Waiting for input", context: null },
    result: { text: "Question" },
    artifacts: [],
  };
}

function makeState(correlationId: string): ConversationState {
  return {
    correlationId,
    originalEnvelope: makeEnvelope(correlationId),
    slackChannel: "C0123456",
    slackThreadTs: "1717000000.123456",
    resumeUrl: `https://n8n.example.com/webhook/${correlationId}`,
    question: "Waiting for answer",
    createdAt: Date.now(),
  };
}

beforeEach(() => {
  process.env["HITL_STATE_PATH"] = TEST_STORE_PATH;
  if (existsSync(TEST_STORE_PATH)) unlinkSync(TEST_STORE_PATH);
});

afterEach(() => {
  if (existsSync(TEST_STORE_PATH)) unlinkSync(TEST_STORE_PATH);
  delete process.env["HITL_STATE_PATH"];
});

// ── T2: back-compat — old Slack-shaped states load without error (R-07) ───

describe("T2: back-compat — old Slack-shaped states load without error (R-07)", () => {
  test("state without channel/round/delivery loads and round-trips", () => {
    const state = makeState("run-legacy-001");
    // Intentionally no channel, round, or delivery
    saveState(state);

    const loaded = loadState("run-legacy-001");
    expect(loaded).not.toBeNull();
    expect(loaded!.channel).toBeUndefined();
    expect(loaded!.round).toBeUndefined();
    expect(loaded!.delivery).toBeUndefined();
    // All original fields intact
    expect(loaded!.slackChannel).toBe("C0123456");
    expect(loaded!.slackThreadTs).toBe("1717000000.123456");
    expect(loaded!.resumeUrl).toContain("run-legacy-001");
    expect(loaded!.question).toBe("Waiting for answer");
  });

  test("legacy state can be re-saved with new fields without data loss", () => {
    const legacy = makeState("run-legacy-002");
    saveState(legacy);

    // Load and upgrade
    const loaded = loadState("run-legacy-002")!;
    const upgraded: ConversationState = {
      ...loaded,
      channel: "discord",
      round: 1,
      delivery: { guildId: "123", channelId: "456" },
    };
    saveState(upgraded);

    const reloaded = loadState("run-legacy-002")!;
    expect(reloaded.channel).toBe("discord");
    expect(reloaded.round).toBe(1);
    expect(reloaded.slackChannel).toBe("C0123456"); // Original field still there
  });
});

// ── T2: channel field (AC4 — multi-channel support) ───────────────────────

describe("T2: channel field (AC4)", () => {
  test("saves and loads channel='slack'", () => {
    const state: ConversationState = {
      ...makeState("run-ch-slack"),
      channel: "slack",
    };
    saveState(state);
    const loaded = loadState("run-ch-slack");
    expect(loaded!.channel).toBe("slack");
  });

  test("saves and loads channel='email'", () => {
    const state: ConversationState = {
      ...makeState("run-ch-email"),
      channel: "email",
    };
    saveState(state);
    const loaded = loadState("run-ch-email");
    expect(loaded!.channel).toBe("email");
  });

  test("saves and loads channel='notify'", () => {
    const state: ConversationState = {
      ...makeState("run-ch-notify"),
      channel: "notify",
    };
    saveState(state);
    const loaded = loadState("run-ch-notify");
    expect(loaded!.channel).toBe("notify");
  });

  test("saves and loads channel='discord'", () => {
    const state: ConversationState = {
      ...makeState("run-ch-discord"),
      channel: "discord",
    };
    saveState(state);
    const loaded = loadState("run-ch-discord");
    expect(loaded!.channel).toBe("discord");
  });

  test("all four channel values round-trip correctly", () => {
    const channels: HitlChannel[] = ["slack", "email", "notify", "discord"];
    for (const ch of channels) {
      const state: ConversationState = {
        ...makeState(`run-ch-${ch}`),
        channel: ch,
      };
      saveState(state);
      const loaded = loadState(`run-ch-${ch}`)!;
      expect(loaded.channel).toBe(ch);
    }
  });

  test("channel field is optional — absent when not set", () => {
    const state = makeState("run-no-ch");
    saveState(state);
    const loaded = loadState("run-no-ch")!;
    expect(loaded.channel).toBeUndefined();
  });
});

// ── T2: round field + nextRound helper (AC3 — multi-round support) ─────────

describe("T2: round field + nextRound helper (AC3)", () => {
  test("saves and loads round number", () => {
    const state: ConversationState = { ...makeState("run-round-3"), round: 3 };
    saveState(state);
    const loaded = loadState("run-round-3");
    expect(loaded!.round).toBe(3);
  });

  test("round field is optional — absent when not set", () => {
    const state = makeState("run-no-round");
    saveState(state);
    const loaded = loadState("run-no-round")!;
    expect(loaded.round).toBeUndefined();
  });

  test("can save round=0", () => {
    const state: ConversationState = { ...makeState("run-round-0"), round: 0 };
    saveState(state);
    const loaded = loadState("run-round-0")!;
    expect(loaded.round).toBe(0);
  });

  test("can save large round numbers", () => {
    const state: ConversationState = {
      ...makeState("run-round-999"),
      round: 999,
    };
    saveState(state);
    const loaded = loadState("run-round-999")!;
    expect(loaded.round).toBe(999);
  });
});

describe("nextRound helper (AC3)", () => {
  test("returns 2 for a state with no round (default-to-1)", () => {
    const state = makeState("run-nr-no-round");
    expect(nextRound(state)).toBe(2);
  });

  test("returns n+1 for round: n", () => {
    expect(nextRound({ ...makeState("run-nr-1"), round: 1 })).toBe(2);
    expect(nextRound({ ...makeState("run-nr-5"), round: 5 })).toBe(6);
    expect(nextRound({ ...makeState("run-nr-99"), round: 99 })).toBe(100);
  });

  test("returns 1 for round: 0", () => {
    expect(nextRound({ ...makeState("run-nr-0"), round: 0 })).toBe(1);
  });

  test("handles large round numbers", () => {
    expect(nextRound({ ...makeState("run-nr-1000"), round: 1000 })).toBe(1001);
  });
});

// ── T2: multi-round workflow (AC3 — R-07 re-park instead of delete) ───────

describe("T2: multi-round workflow (AC3 — R-07)", () => {
  test("save → load → bump → re-save → load preserves multi-round capability", () => {
    // Round 1: save initial state
    const round1: ConversationState = {
      ...makeState("run-multi-workflow"),
      channel: "slack",
      round: 1,
    };
    saveState(round1);

    // Resume phase: load, bump round, re-save (re-park for another round)
    const loaded = loadState("run-multi-workflow")!;
    expect(loaded.round).toBe(1);

    const round2: ConversationState = { ...loaded, round: nextRound(loaded) };
    saveState(round2);

    // Verify state is re-parked for round 2, not deleted (R-07)
    const reloaded = loadState("run-multi-workflow")!;
    expect(reloaded.round).toBe(2);
    expect(reloaded.channel).toBe("slack");
    expect(reloaded.correlationId).toBe("run-multi-workflow");
  });

  test("multi-round with channel change persists both", () => {
    // Round 1: Slack
    const round1: ConversationState = {
      ...makeState("run-ch-switch"),
      channel: "slack",
      round: 1,
    };
    saveState(round1);

    // Resume as round 2: switch to Discord
    const loaded = loadState("run-ch-switch")!;
    const round2: ConversationState = {
      ...loaded,
      channel: "discord",
      round: nextRound(loaded),
    };
    saveState(round2);

    const reloaded = loadState("run-ch-switch")!;
    expect(reloaded.round).toBe(2);
    expect(reloaded.channel).toBe("discord");
  });

  test("three-round back-and-forth: round 1 → 2 → 3", () => {
    // Round 1
    let state: ConversationState = {
      ...makeState("run-3round"),
      channel: "email",
      round: 1,
    };
    saveState(state);

    // Round 2
    let loaded = loadState("run-3round")!;
    state = { ...loaded, round: nextRound(loaded) };
    saveState(state);

    // Round 3
    loaded = loadState("run-3round")!;
    state = { ...loaded, round: nextRound(loaded) };
    saveState(state);

    // Verify final state
    const final = loadState("run-3round")!;
    expect(final.round).toBe(3);
    expect(final.channel).toBe("email");
  });
});

// ── T2: delivery bag for channel-specific coordinates ────────────────────

describe("T2: delivery bag", () => {
  test("saves and loads a generic delivery record (Discord case)", () => {
    const state: ConversationState = {
      ...makeState("run-delivery-discord"),
      channel: "discord",
      delivery: {
        guildId: "123456789",
        channelId: "987654321",
        messageId: "msg-42",
      },
    };
    saveState(state);

    const loaded = loadState("run-delivery-discord")!;
    expect(loaded.delivery).toBeDefined();
    expect(loaded.delivery!["guildId"]).toBe("123456789");
    expect(loaded.delivery!["channelId"]).toBe("987654321");
    expect(loaded.delivery!["messageId"]).toBe("msg-42");
  });

  test("saves and loads delivery with nested objects (Email case)", () => {
    const state: ConversationState = {
      ...makeState("run-delivery-email"),
      channel: "email",
      delivery: {
        threadId: "th-abc",
        headers: { "In-Reply-To": "<abc@example.com>" },
      },
    };
    saveState(state);

    const loaded = loadState("run-delivery-email")!;
    const headers = loaded.delivery!["headers"] as Record<string, string>;
    expect(headers["In-Reply-To"]).toBe("<abc@example.com>");
  });

  test("delivery bag is optional — absent when not set", () => {
    const state: ConversationState = {
      ...makeState("run-no-delivery"),
      channel: "slack",
    };
    saveState(state);
    const loaded = loadState("run-no-delivery")!;
    expect(loaded.delivery).toBeUndefined();
  });

  test("delivery bag can be updated between rounds", () => {
    // Round 1: initial delivery
    const round1: ConversationState = {
      ...makeState("run-delivery-update"),
      channel: "discord",
      round: 1,
      delivery: { guildId: "111", channelId: "222" },
    };
    saveState(round1);

    // Round 2: update delivery (e.g. add messageId)
    const loaded = loadState("run-delivery-update")!;
    const round2: ConversationState = {
      ...loaded,
      round: nextRound(loaded),
      delivery: {
        ...loaded.delivery,
        messageId: "msg-updated",
      },
    };
    saveState(round2);

    const reloaded = loadState("run-delivery-update")!;
    expect(reloaded.delivery!["messageId"]).toBe("msg-updated");
    expect(reloaded.delivery!["guildId"]).toBe("111"); // Original preserved
  });
});

// ── T2: composite multi-round + multi-channel scenario ────────────────────

describe("T2: composite multi-round + multi-channel scenarios", () => {
  test("full workflow: legacy → upgraded to multi-channel → multi-round back-and-forth", () => {
    // Start with legacy Slack state
    const legacy: ConversationState = makeState("run-composite");
    saveState(legacy);

    let loaded = loadState("run-composite")!;
    expect(loaded.channel).toBeUndefined();
    expect(loaded.round).toBeUndefined();

    // Upgrade: add channel and start round 1
    let state: ConversationState = {
      ...loaded,
      channel: "slack",
      round: 1,
    };
    saveState(state);

    // Resume round 1: switch to Discord for round 2
    loaded = loadState("run-composite")!;
    state = {
      ...loaded,
      channel: "discord",
      round: nextRound(loaded),
      delivery: { guildId: "999", channelId: "888" },
    };
    saveState(state);

    // Final verification
    const final = loadState("run-composite")!;
    expect(final.channel).toBe("discord");
    expect(final.round).toBe(2);
    expect(final.slackChannel).toBe("C0123456"); // Legacy Slack field still there
    expect(final.delivery!["guildId"]).toBe("999");
  });

  test("state with all new fields set correctly round-trips", () => {
    const state: ConversationState = {
      ...makeState("run-full-new-fields"),
      channel: "notify",
      round: 5,
      delivery: { notificationId: "n-123", channelType: "push" },
    };
    saveState(state);

    const loaded = loadState("run-full-new-fields")!;
    expect(loaded.channel).toBe("notify");
    expect(loaded.round).toBe(5);
    expect(loaded.delivery!["notificationId"]).toBe("n-123");
    expect(loaded.delivery!["channelType"]).toBe("push");
    // All original fields intact too
    expect(loaded.correlationId).toBe("run-full-new-fields");
    expect(loaded.slackChannel).toBe("C0123456");
  });
});
