import { describe, expect, it } from "vitest";
import { WIDGET_CHANNEL } from "../src/widget/index.js";
import { FULL_PAGE_CHANNEL } from "../src/full-page/index.js";
import { MOBILE_SDK_CHANNEL } from "../src/mobile-sdk/index.js";
import { MESSAGING_CHANNEL } from "../src/messaging/index.js";

describe("@sevana/channels", () => {
  it("declares the four channel identifiers", () => {
    expect([WIDGET_CHANNEL, FULL_PAGE_CHANNEL, MOBILE_SDK_CHANNEL, MESSAGING_CHANNEL]).toEqual([
      "widget",
      "full-page",
      "mobile-sdk",
      "messaging-whatsapp",
    ]);
  });
});
