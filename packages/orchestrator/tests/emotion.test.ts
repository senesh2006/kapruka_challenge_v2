import { describe, expect, it } from "vitest";
import { deriveEmotion } from "../src/index.js";
import type { CandidatePlan, WorkingBrief } from "../src/index.js";

function brief(situation: string): WorkingBrief {
  return { situation, detectedLocale: "en", slots: [] };
}

function planWith(hasItems: boolean): CandidatePlan {
  return {
    brief: brief(""),
    candidatesBySlot: hasItems
      ? {
          primary: [
            {
              slotId: "primary",
              product: {
                id: "p-1" as never,
                title: "Cake",
                imageUrl: "https://img.example.com/x.jpg",
                price: { amount: 100, currency: "LKR" as never },
                categoryIds: [],
                available: true,
              },
              reason: "r",
              rank: 0,
              appliedRules: [],
            },
          ],
        }
      : {},
    cart: [],
  };
}

describe("deriveEmotion", () => {
  it("bereavement cues → condolence, never celebratory (even if items present)", () => {
    expect(
      deriveEmotion({
        reply: "I'm so sorry for your loss.",
        brief: brief("my grandma passed away and I'm in Australia, what can I send home"),
        plan: planWith(true),
      }),
    ).toBe("condolence");
  });

  it("a funeral mention outranks a birthday mention", () => {
    expect(
      deriveEmotion({
        reply: "Something dignified.",
        brief: brief("missed her birthday, now it's her funeral"),
        plan: planWith(true),
      }),
    ).toBe("condolence");
  });

  it("apology cues → apologetic", () => {
    expect(
      deriveEmotion({
        reply: "I'm so sorry you couldn't be there.",
        brief: brief("I need to apologise to my wife"),
        plan: planWith(true),
      }),
    ).toBe("apologetic");
  });

  it("occasion cues → celebratory", () => {
    expect(
      deriveEmotion({
        reply: "A birthday in Galle — lovely!",
        brief: brief("amma's birthday"),
        plan: planWith(true),
      }),
    ).toBe("celebratory");
  });

  it("gift cues with items → excited", () => {
    expect(
      deriveEmotion({
        reply: "A thoughtful surprise to spoil her.",
        brief: brief("a gift to surprise my partner"),
        plan: planWith(true),
      }),
    ).toBe("excited");
  });

  it("items but no special cue → warm", () => {
    expect(
      deriveEmotion({ reply: "Here's what I'd recommend.", brief: brief("need a thing"), plan: planWith(true) }),
    ).toBe("warm");
  });

  it("no items yet → thoughtful", () => {
    expect(
      deriveEmotion({ reply: "Tell me a little more.", brief: brief("hmm"), plan: planWith(false) }),
    ).toBe("thoughtful");
  });
});
