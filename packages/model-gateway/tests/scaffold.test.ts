import { describe, expect, it } from "vitest";
import { MODEL_GATEWAY_PACKAGE } from "../src/index.js";

describe("@sevana/model-gateway", () => {
  it("exposes its package marker", () => {
    expect(MODEL_GATEWAY_PACKAGE).toBe("@sevana/model-gateway");
  });
});
