import { describe, expect, it, vi } from "vitest";
import { SessionSchema, type Session } from "@sevana/shared";
import type { ChatResponse, ModelTaskRequest } from "@sevana/model-gateway";
import {
  NimConciergeAgent,
  type CandidatePlan,
  type ConciergeModel,
} from "../src/index.js";

const NOW = "2026-06-07T10:00:00.000Z";

const persona = {
  brandVoice: "Hari",
  tone: ["warm", "opinionated"],
  opinions: ["Sunflowers over roses for amma."],
  languages: ["en", "si", "ta", "tanglish"] as ("en" | "si" | "ta" | "tanglish")[],
  signatureBehaviours: [],
};

function session(): Session {
  return SessionSchema.parse({
    id: "sess-1",
    tenantId: "kapruka",
    channel: "full-page",
    startedAt: NOW,
    lastTouchedAt: NOW,
  });
}

function toolCallResponse(args: unknown): ChatResponse {
  return {
    id: "cmpl-1",
    model: "meta/llama-3.3-70b-instruct",
    created: 1,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "set_brief", arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

function textResponse(content: string): ChatResponse {
  return {
    id: "cmpl-2",
    model: "meta/llama-3.3-70b-instruct",
    created: 1,
    choices: [
      { index: 0, finish_reason: "stop", message: { role: "assistant", content } },
    ],
  };
}

function fakeModel(handler: (task: ModelTaskRequest) => ChatResponse | Promise<ChatResponse>): {
  model: ConciergeModel;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async (task: ModelTaskRequest) => handler(task));
  return {
    model: { run, gracefulMessage: () => "One moment — I'm having trouble thinking." },
    run,
  };
}

function planWith(items: Array<{ id: string; title: string; price: number; reason: string }>): CandidatePlan {
  return {
    brief: {
      situation: "Birthday for amma in Galle",
      detectedLocale: "en",
      slots: [{ id: "primary", description: "birthday cake", categoryHints: [], required: true }],
    },
    candidatesBySlot: {
      primary: items.map((i, idx) => ({
        slotId: "primary",
        product: {
          id: i.id as never,
          title: i.title,
          imageUrl: "https://img.example.com/x.jpg",
          price: { amount: i.price, currency: "LKR" as never },
          categoryIds: [],
          available: true,
        },
        reason: i.reason,
        rank: idx,
        appliedRules: [],
      })),
    },
    delivery: {
      destination: "Galle",
      feasible: true,
      earliestDate: "2026-06-10T00:00:00.000Z",
      perishableWarnings: ["Cake is perishable"],
      notes: [],
    },
    cart: [],
  };
}

describe("NimConciergeAgent.read", () => {
  it("uses tool calling and maps the structured brief", async () => {
    const { model, run } = fakeModel(() =>
      toolCallResponse({
        detectedLocale: "tanglish",
        situation: "Birthday for amma, diaspora sender",
        recipient: "amma",
        destination: "Galle",
        budgetMax: 6000,
        slots: [
          { id: "cake", description: "birthday cake", categoryHints: ["cake"] },
          { id: "flowers", description: "yellow flowers", categoryHints: ["flowers"] },
        ],
      }),
    );
    const agent = new NimConciergeAgent(model);
    const { brief } = await agent.read({
      message: "Aiyo machan, amma's birthday — cake and yellow flowers to Galle, 6000 max",
      session: session(),
      persona,
    });

    expect(brief.detectedLocale).toBe("tanglish");
    expect(brief.recipient).toBe("amma");
    expect(brief.destination).toBe("Galle");
    expect(brief.budget).toEqual({ max: 6000, currency: "LKR" });
    expect(brief.slots.map((s) => s.id)).toEqual(["cake", "flowers"]);

    const task = run.mock.calls[0]![0] as ModelTaskRequest;
    expect(task.kind).toBe("reasoning");
    expect(task.task).toBe("concierge.read");
    expect(task.request.tools).toHaveLength(1);
    expect(task.request.tool_choice).toBe("required");
  });

  it("falls back to a naive single-slot brief when the gateway throws", async () => {
    const run = vi.fn(async () => {
      throw new Error("NIM down");
    });
    const agent = new NimConciergeAgent({ run, gracefulMessage: () => "x" });
    const { brief } = await agent.read({
      message: "Aiyo, amma's birthday cake",
      session: session(),
      persona,
    });
    expect(brief.slots).toHaveLength(1);
    expect(brief.slots[0]?.id).toBe("primary");
    expect(brief.detectedLocale).toBe("tanglish"); // regex fallback caught "aiyo"/"amma"
  });

  it("falls back when the model returns garbage instead of a tool call", async () => {
    const { model } = fakeModel(() => textResponse("I refuse to call tools"));
    const agent = new NimConciergeAgent(model);
    const { brief } = await agent.read({
      message: "Wedding gift for a colleague",
      session: session(),
      persona,
    });
    expect(brief.slots[0]?.description).toBe("Wedding gift for a colleague");
    expect(brief.detectedLocale).toBe("en");
  });

  it("keeps the previous brief on fallback instead of clobbering it", async () => {
    const run = vi.fn(async () => {
      throw new Error("NIM down");
    });
    const agent = new NimConciergeAgent({ run, gracefulMessage: () => "x" });
    const previousBrief = {
      situation: "Anniversary in Kandy",
      detectedLocale: "en" as const,
      slots: [{ id: "lamps", description: "brass lamps", categoryHints: [], required: true }],
    };
    const { brief } = await agent.read({
      message: "actually make it two",
      session: session(),
      persona,
      previousBrief,
    });
    expect(brief).toBe(previousBrief);
  });
});

describe("NimConciergeAgent.present", () => {
  it("renders the model's reply without tools, pinning items + prices in the prompt", async () => {
    const { model, run } = fakeModel(() =>
      textResponse("For amma, the kiri-bath cake — and sunflowers, always sunflowers."),
    );
    const agent = new NimConciergeAgent(model);
    const plan = planWith([
      { id: "kap-cake-1", title: "Kiri-bath cake 500g", price: 2400, reason: "Her favourite" },
    ]);

    const result = await agent.present({ plan, persona, session: session(), locale: "en" });

    expect(result.reply).toContain("sunflowers");
    expect(result.cardRefs).toEqual(["kap-cake-1"]);

    const task = run.mock.calls[0]![0] as ModelTaskRequest;
    expect(task.task).toBe("concierge.present");
    expect(task.request.tools).toBeUndefined();
    const userMsg = task.request.messages[1]?.content as string;
    expect(userMsg).toContain("Kiri-bath cake 500g");
    expect(userMsg).toContain("2400 LKR");
    expect(userMsg).toContain("Galle");
    const systemMsg = task.request.messages[0]?.content as string;
    expect(systemMsg).toContain("never invent products");
    expect(systemMsg).toContain("Sunflowers over roses");
  });

  it("degrades to gracefulMessage + grounded plain list when the gateway throws", async () => {
    const run = vi.fn(async () => {
      throw new Error("NIM down");
    });
    const agent = new NimConciergeAgent({
      run,
      gracefulMessage: () => "One moment.",
    });
    const plan = planWith([
      { id: "kap-cake-1", title: "Kiri-bath cake 500g", price: 2400, reason: "Her favourite" },
    ]);

    const result = await agent.present({ plan, persona, session: session(), locale: "en" });
    expect(result.reply).toContain("One moment.");
    expect(result.reply).toContain("Kiri-bath cake 500g");
    expect(result.cardRefs).toEqual(["kap-cake-1"]);
  });

  it("returns an honest ask without any model call when the plan is empty", async () => {
    const { model, run } = fakeModel(() => textResponse("should not be called"));
    const agent = new NimConciergeAgent(model);
    const plan: CandidatePlan = {
      brief: { situation: "x", detectedLocale: "en", slots: [] },
      candidatesBySlot: {},
      cart: [],
    };
    const result = await agent.present({ plan, persona, session: session(), locale: "en" });
    expect(result.cardRefs).toEqual([]);
    expect(result.reply).toMatch(/tell me a little more/i);
    expect(run).not.toHaveBeenCalled();
  });
});
