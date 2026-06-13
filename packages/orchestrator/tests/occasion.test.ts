import { describe, expect, it } from "vitest";
import { SessionSchema, type Session } from "@sevana/shared";
import { StubConciergeAgent, detectOccasion } from "../src/index.js";

const NOW = "2026-06-07T10:00:00.000Z";
const persona = { brandVoice: "Hari", tone: [], opinions: [], languages: ["en"] as ("en")[], signatureBehaviours: [] };
function session(): Session {
  return SessionSchema.parse({ id: "s-1", tenantId: "kapruka", channel: "full-page", startedAt: NOW, lastTouchedAt: NOW });
}

describe("detectOccasion", () => {
  it("reads bereavement, not birthday, for a death", () => {
    expect(detectOccasion("my grandma passed away and I'm in Australia")).toBe("bereavement");
    expect(detectOccasion("need something for the funeral back home")).toBe("bereavement");
  });
  it("reads other occasions", () => {
    expect(detectOccasion("birthday cake for amma")).toBe("birthday");
    expect(detectOccasion("my friend's wedding next week")).toBe("wedding");
    expect(detectOccasion("I need to apologise to my wife")).toBe("apology");
    expect(detectOccasion("just browsing")).toBe("generic");
  });
});

describe("StubConciergeAgent — situation-aware slots", () => {
  it("a bereavement produces sympathy slots, not a cake", async () => {
    const agent = new StubConciergeAgent();
    const { brief } = await agent.read({
      message: "my grandma passed away, I'm overseas, what can I send home",
      session: session(),
      persona,
    });
    const hints = brief.slots.flatMap((s) => s.categoryHints);
    expect(hints).toContain("sympathy");
    expect(brief.slots.some((s) => s.categoryHints.includes("cake"))).toBe(false);
  });

  it("a birthday still produces a cake slot with id 'primary'", async () => {
    const agent = new StubConciergeAgent();
    const { brief } = await agent.read({
      message: "birthday cake for amma in Galle",
      session: session(),
      persona,
    });
    expect(brief.slots[0]?.id).toBe("primary");
    expect(brief.slots[0]?.categoryHints).toContain("cake");
  });
});
